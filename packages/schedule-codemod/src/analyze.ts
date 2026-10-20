import { matchesGlob, relative } from "node:path";
import { NodeBuilderFlags, SignatureKind, SymbolFlags } from "typescript/unstable/sync";
import type { Project, Signature } from "typescript/unstable/sync";
import { SyntaxKind, isCallExpression, isCallSignatureDeclaration, isFunctionTypeNode, isFunctionDeclaration, isFunctionExpression, isArrowFunction, isMethodDeclaration, isClassDeclaration, isVariableDeclaration, isPropertyDeclaration, isPropertyAssignment, isPropertyAccessExpression, isNewExpression, isReturnStatement } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";

export interface Exclusion {
  /** Glob relative to the source directory, e.g. language/parser.ts. */
  file: string;
  /** Function name or Class.method; supports globs. */
  name: string;
}

export interface SourceAnalysis {
  functions: Map<number, { skip: boolean; signature?: string }>;
  calls: Map<number, { direct: boolean; hasCommand?: boolean; targets?: { file: string; end: number }[] }>;
  constructors: Map<number, string>;
  transformed?: Set<number>;
  commandTargets?: Map<string, Set<number>>;
}

export function analyze(project: Project, source: SourceFile, root: string, exclude: Exclusion[]): SourceAnalysis {
  const { checker, emitter } = project;
  const result: SourceAnalysis = { functions: new Map(), calls: new Map(), constructors: new Map() };
  function excluded(node: Node): boolean {
    let name = "";
    if ("name" in node && node.name) name = (node.name as Node).getText();
    else if (isVariableDeclaration(node.parent) || isPropertyAssignment(node.parent)) name = node.parent.name.getText();
    if (isClassDeclaration(node.parent)) name = `${node.parent.name?.getText()}.${name}`;
    const file = relative(root, node.getSourceFile().fileName).replaceAll("\\", "/");
    return exclude.some(rule => matchesGlob(file, rule.file) && matchesGlob(name, rule.name));
  }
  function printSignature(signature: Signature, node: Node) {
    const declaration = checker.signatureToSignatureDeclaration(signature, SyntaxKind.FunctionType, node,
      NodeBuilderFlags.NoTruncation | NodeBuilderFlags.UseFullyQualifiedType);
    return declaration ? emitter.printNode(declaration) : undefined;
  }
  function factoryResult(call: Node): Node | undefined {
    if (!isCallExpression(call)) return;
    const factory = checker.getResolvedSignature(call)?.declaration?.resolve();
    if (!factory || !(isFunctionDeclaration(factory) || isFunctionExpression(factory) || isArrowFunction(factory) || isMethodDeclaration(factory))
      || factory.type || !factory.body || factory.asteriskToken
      || factory.modifiers?.some(modifier => modifier.kind === SyntaxKind.AsyncKeyword)) return;
    // Only infer a concrete target when the factory returns one function.
    // Explicit return annotations can hide its generated command property.
    const returns: (Node | undefined)[] = [];
    function visitReturns(node: Node): void {
      if (isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node) || isMethodDeclaration(node) || isClassDeclaration(node)) return;
      if (isReturnStatement(node)) returns.push(node.expression);
      else node.forEachChild(visitReturns);
    }
    if (factory.body.kind === SyntaxKind.Block) visitReturns(factory.body);
    else returns.push(factory.body);
    const value = returns.length === 1 ? returns[0] : undefined;
    return value && (isFunctionExpression(value) || isArrowFunction(value)) ? value : undefined;
  }
  function visit(node: Node): void {
    if (isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node) || isMethodDeclaration(node)) {
      const type = checker.getTypeAtLocation(node);
      const signatures = type ? checker.getSignaturesOfType(type, SignatureKind.Call) : [];
      const skip = excluded(node) || signatures.some(sig => !!checker.getTypePredicateOfSignature(sig));
      const signature = signatures.length === 1 ? printSignature(signatures[0]!, node) : undefined;
      result.functions.set(node.end, { skip, ...(signature ? { signature } : {}) });
    }
    if (isCallExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      let declaration = signature?.declaration?.resolve();
      // Function.call/apply resolve to lib.d.ts; inspect their target instead.
      const indirect = isPropertyAccessExpression(node.expression) && ["call", "apply"].includes(node.expression.name.getText());
      if (indirect && isPropertyAccessExpression(node.expression)) {
        const type = checker.getTypeAtLocation(node.expression.expression);
        const sig = type && checker.getSignaturesOfType(type, SignatureKind.Call)[0];
        declaration = sig?.declaration?.resolve();
      }
      const file = declaration?.getSourceFile();
      // A callable interface/type describes a callback, not an external
      // implementation. In particular, narrowing to SchedulableFunction must
      // not turn a scheduled callback into a synchronous call.
      const callableType = !!declaration && (isCallSignatureDeclaration(declaration) || isFunctionTypeNode(declaration));
      let direct = !!signature && !!checker.getTypePredicateOfSignature(signature)
        || !!declaration && excluded(declaration)
        || !callableType && !!file && (file.isDeclarationFile || relative(root, file.fileName).startsWith(".."));
      const callee = indirect && isPropertyAccessExpression(node.expression)
        ? node.expression.expression : node.expression;
      let symbol = checker.getSymbolAtLocation(callee);
      if (symbol && (symbol.flags & SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
      const boundDeclaration = symbol?.valueDeclaration?.resolve();
      const declarations = boundDeclaration ? [boundDeclaration] : symbol?.declarations.map(handle => handle.resolve()) ?? [];
      if (!boundDeclaration && declarations.length > 1) {
        // A union's resolved signature can represent only one of its members.
        direct = !!signature && !!checker.getTypePredicateOfSignature(signature);
      }
      // Boolean's callable interface is not a callback when the value itself
      // resolves to the standard-library global. Locally shadowed values stay dynamic.
      direct ||= !!boundDeclaration && isVariableDeclaration(boundDeclaration)
        && boundDeclaration.name.getText() === "Boolean"
        && project.program.isSourceFileDefaultLibrary(boundDeclaration.getSourceFile());
      direct ||= declarations.length > 0 && declarations.every(node => !!node && excluded(node));
      // A concrete implementation tells us whether this target is transformed.
      // Function-typed parameters and properties remain dynamic targets.
      const targets = declarations.map(node => {
        if (node && (isVariableDeclaration(node) || isPropertyDeclaration(node) || isPropertyAssignment(node))) {
          const annotated = "type" in node && !!node.type;
          node = node.initializer;
          if (node && !annotated && isCallExpression(node)) node = factoryResult(node);
        }
        return node && (isFunctionDeclaration(node) || isMethodDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node))
          ? { file: node.getSourceFile().fileName, end: node.end } : undefined;
      });
      const calleeType = checker.getTypeAtLocation(callee);
      const commandProperty = calleeType && checker.getPropertyOfType(calleeType, "command");
      const hasCommand = !!commandProperty && !(commandProperty.flags & SymbolFlags.Optional);
      result.calls.set(node.end, { direct, hasCommand, ...(targets.length && targets.every(target => !!target) ? { targets } : {}) });
    }
    if (isNewExpression(node) && !node.typeArguments?.length) {
      const type = checker.getTypeAtLocation(node);
      if (type) result.constructors.set(node.end, checker.typeToString(type, node, 1|64));
    }
    node.forEachChild(visit);
  }
  visit(source);
  return result;
}
