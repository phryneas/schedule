import { matchesGlob, relative } from "node:path";
import { NodeBuilderFlags, SignatureKind } from "typescript/unstable/sync";
import type { Project, Signature } from "typescript/unstable/sync";
import { SyntaxKind, isCallExpression, isFunctionDeclaration, isFunctionExpression, isArrowFunction, isMethodDeclaration, isClassDeclaration, isVariableDeclaration, isPropertyAssignment, isPropertyAccessExpression, isNewExpression } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";

export interface Exclusion {
  /** Glob relative to the source directory, e.g. language/parser.ts. */
  file: string;
  /** Function name or Class.method; supports globs. */
  name: string;
}

export interface SourceAnalysis {
  functions: Map<number, { skip: boolean; signature?: string; thisType?: string }>;
  calls: Map<number, { direct: boolean }>;
  constructors: Map<number, string>;
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
  function visit(node: Node): void {
    if (isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node) || isMethodDeclaration(node)) {
      const type = checker.getTypeAtLocation(node);
      const signatures = type ? checker.getSignaturesOfType(type, SignatureKind.Call) : [];
      const skip = excluded(node) || signatures.some(sig => !!checker.getTypePredicateOfSignature(sig));
      const signature = signatures.length === 1 ? printSignature(signatures[0]!, node) : undefined;
      result.functions.set(node.end, { skip, ...(signature ? { signature } : {}) });
      if (isMethodDeclaration(node) && node.parent.kind === SyntaxKind.ObjectLiteralExpression) {
        let thisType: string | undefined;
        function findThis(child: Node): void {
          if (thisType || isFunctionDeclaration(child) || isFunctionExpression(child) || isMethodDeclaration(child) || isClassDeclaration(child)) return;
          if (child.kind === SyntaxKind.ThisKeyword) {
            const type = checker.getTypeAtLocation(child);
            if (type) thisType = checker.typeToString(type, node, NodeBuilderFlags.NoTruncation | NodeBuilderFlags.UseFullyQualifiedType);
          } else child.forEachChild(findThis);
        }
        node.body?.forEachChild(findThis);
        if (thisType) result.functions.get(node.end)!.thisType = thisType;
      }
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
      const direct = !!signature && !!checker.getTypePredicateOfSignature(signature)
        || !!declaration && excluded(declaration)
        || !!file && (file.isDeclarationFile || relative(root, file.fileName).startsWith(".."));
      result.calls.set(node.end, { direct });
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
