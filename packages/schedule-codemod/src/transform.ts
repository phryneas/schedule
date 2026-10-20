import { parseSync, traverse } from "@babel/core";
import type { NodePath, PluginObj } from "@babel/core";
import type * as Types from "@babel/types";
import type { SourceAnalysis } from "./analyze.ts";

export interface SchedulerPluginOptions {
  /** Import path for the scheduler runtime. */
  runtimeModule?: string;
  typeImportResolutionMode?: "import" | "require";
  analysis?: SourceAnalysis;
}

/** Run before TypeScript stripping and module transforms. */
export default function schedulerPlugin(
  api: { types: typeof Types; assertVersion(version: number): void },
  options: SchedulerPluginOptions = {},
): PluginObj {
  api.assertVersion(7);
  const t = api.types;
  return {
    name: "schedulable-functions",
    visitor: {
      Program(program, state) {
        const make = program.scope.generateUidIdentifier("makeSchedulable");
        const commands = program.scope.generateUidIdentifier("commands");
        const iterable = program.scope.generateUidIdentifier("SchedulableIterable");
        const marker = program.scope.generateUidIdentifier("schedulableImplementationSignal");
        const methodType = program.scope.generateUidIdentifier("SchedulableMethod");
        const functionType = program.scope.generateUidIdentifier("SchedulableFunction");
        const functions: NodePath<any>[] = [];
        const signatureNamespaces = new Map<NodePath<any>, Types.Statement[]>();
        const classesWithStaticInitialization = new WeakSet<Types.ClassBody>();
        const hoisted = new Map<NodePath<any>, Types.Statement[]>();
        const localCalls = new WeakSet<Types.CallExpression>();
        const optedIn = new WeakSet<Types.Node>();
        const synchronousCalls = new WeakSet<Types.Node>();
        const explicitScopes = new WeakSet<Types.Node>();
        function isExplicit(path: NodePath): boolean {
          for (let scope: NodePath | null = path; scope; scope = scope.parentPath) {
            if (explicitScopes.has(scope.node)) return true;
          }
          return false;
        }
        let used = false;
        let usedCommands = false;
        let usedRuntimeMarker = false;
        let usedTypes = false;
        let usedMethodType = false;
        let usedFunctionType = false;
        function clone<T extends Types.Node>(node: T): T {
          const copy = t.cloneNode(node, true);
          const originals: any[] = [];
          t.traverseFast(node, original => { originals.push(original); });
          let index = 0;
          t.traverseFast(copy, (cloned: any) => {
            const original = originals[index++];
            if (original.comments) cloned.comments = original.comments;
          });
          return copy;
        }
        function preserveComments(target: any, ...sources: any[]) {
          for (const source of sources) t.inheritsComments(target, source);
          // Recast uses `comments`, which Babel's cloneNode/inheritsComments omit.
          const comments = [...new Set(sources.flatMap(source => source.comments ?? []))];
          if (comments.length) target.comments = comments;
        }
        function parseSignature(text: string): Types.TSFunctionType {
          const ast = parseSync(`type Signature = ${text}`, { configFile: false, babelrc: false, parserOpts: { plugins: ["typescript"] } })!;
          return (ast.program.body[0] as Types.TSTypeAliasDeclaration).typeAnnotation as Types.TSFunctionType;
        }

        function hasYield(path: NodePath<any>): boolean {
          let found = false;
          path.traverse({
            Function(inner) { inner.skip(); },
            Class(inner) { inner.skip(); },
            YieldExpression() { found = true; },
          });
          return found;
        }

        function eligibleScope(path: NodePath<any>): boolean {
          if (path.isClassMethod() || path.isClassPrivateMethod()) return true;
          if (path.isObjectMethod()) return false;
          const parent = path.parentPath!;
          if (parent.isClassProperty() || parent.isClassPrivateProperty()) return true;
          if (parent.isProgram()) return true;
          if (parent.isExportDeclaration()) return parent.parentPath.isProgram();
          if (parent.isVariableDeclarator() && path.key === "init") {
            const declaration = parent.parentPath;
            const container = declaration.parentPath!;
            return container.isProgram() || container.isExportNamedDeclaration() && container.parentPath.isProgram();
          }
          return false;
        }

        program.traverse({
          Class(path) {
            if (path.node.body.body.some(member => t.isStaticBlock(member) ||
                (t.isClassProperty(member) || t.isClassPrivateProperty(member)) && member.static && member.value)) {
              classesWithStaticInitialization.add(path.node.body);
            }
          },
          CallExpression(path) {
            if (!t.isIdentifier(path.node.callee)) return;
            const binding = path.scope.getBinding(path.node.callee.name);
            if (!binding) return;
            if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
              if (!(binding.path.parent as Types.ImportDeclaration).source.value.startsWith(".")) return;
            }
            localCalls.add(path.node);
          },
          Function(path) {
            const info = options.analysis?.functions.get(path.node.end!);
            const marked = path.node.leadingComments?.some(comment => comment.value.trim() === "@phryneas/schedule schedulable");
            if (marked) {
              if (info?.skip || path.node.async || path.node.generator ||
                  t.isTSTypePredicate((path.node.returnType as Types.TSTypeAnnotation)?.typeAnnotation) ||
                  ((path.isClassMethod() || path.isObjectMethod()) && path.node.kind !== "method")) {
                throw path.buildCodeFrameError("schedulable cannot opt an excluded, async, generator, constructor, or accessor function into transformation.");
              }
              optedIn.add(path.node);
            }
            if (!marked && !eligibleScope(path)) return;
            if (info?.skip || t.isTSTypePredicate((path.node.returnType as Types.TSTypeAnnotation)?.typeAnnotation)) {
              path.skip();
              return;
            }
            if (path.node.generator) {
              path.skip();
              return;
            }
            if ((path.isClassMethod() || path.isObjectMethod()) && path.node.kind !== "method") return;
            if (path.node.body) functions.push(path);
          },
        });

        const directives = new Map<NodePath<any>, Array<{ block: NodePath<Types.BlockStatement>; comment: Types.Comment }>>();
        const comments = new Set<Types.Comment>(state.file.ast.comments ?? []);
        t.traverseFast(program.node, (node: any) => {
          for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
            for (const comment of node[key] ?? []) comments.add(comment);
          }
        });
        for (const comment of comments) {
          if (comment.value.trim() !== "@phryneas/schedule explicit") continue;
          const start = comment.start!;
          const end = comment.end!;
          const source = state.file.code;
          const lineStart = source.lastIndexOf("\n", start - 1) + 1;
          const lineEnd = source.indexOf("\n", end);
          let scope: NodePath<Types.Program | Types.BlockStatement> = program;
          program.traverse({
            BlockStatement(block) {
              if (block.node.start! < start && block.node.end! > end &&
                  (scope.isProgram() || block.node.start! > scope.node.start!)) scope = block;
            },
          });
          const statements = [...scope.node.directives, ...scope.node.body];
          if (source.slice(lineStart, start).trim() || source.slice(end, lineEnd < 0 ? source.length : lineEnd).trim() ||
              statements.some(statement => statement.start! < start &&
                (scope.isBlockStatement() || statement.end! > end))) {
            throw program.buildCodeFrameError("explicit must be a standalone comment at file scope or before the first statement of a braced block.");
          }
          explicitScopes.add(scope.node);
        }
        for (const comment of comments) {
          if (comment.value.trim() !== "@phryneas/schedule synchronous") continue;
          let target: Types.Node | undefined;
          program.traverse({
            "CallExpression|OptionalCallExpression"(call: NodePath<any>) {
              let owner: NodePath<any> = call;
              if (owner.parentPath?.isAssignmentExpression() && owner.key === "right") owner = owner.parentPath;
              if (owner.parentPath?.isReturnStatement() || owner.parentPath?.isExpressionStatement()) owner = owner.parentPath;
              else if (owner.parentPath?.isVariableDeclarator() && owner.key === "init" &&
                       owner.parentPath.parentPath?.isVariableDeclaration() && owner.parentPath.parentPath.node.declarations.length === 1) {
                owner = owner.parentPath.parentPath;
              }
              if ([call.node, owner.node].some(node => node.leadingComments?.some((c: Types.Comment) =>
                c.start === comment.start && c.end === comment.end))) {
                target = call.node;
              }
            },
          });
          if (!target) {
            throw program.buildCodeFrameError("synchronous must immediately precede a call or a return, assignment, or single-variable declaration whose value is a call.");
          }
          synchronousCalls.add(target);
        }
        const markers = [...comments].filter(comment =>
          comment.type === "CommentLine" && comment.value.trim() === "@phryneas/schedule may-yield-here");
        for (const comment of markers) {
          const start = comment.start!;
          const end = comment.end!;
          const source = state.file.code;
          const lineStart = source.lastIndexOf("\n", start - 1) + 1;
          const lineEnd = source.indexOf("\n", end);
          let block: NodePath<Types.BlockStatement> | undefined;
          program.traverse({
            BlockStatement(candidate) {
              if (candidate.node.start! < start && candidate.node.end! > end &&
                  (!block || candidate.node.start! > block.node.start!)) block = candidate;
            },
          });
          if (!block || source.slice(lineStart, start).trim() || source.slice(end, lineEnd < 0 ? source.length : lineEnd).trim() ||
              block.node.body.some(statement => statement.start! < start && statement.end! > end)) {
            throw program.buildCodeFrameError("may-yield-here must be a standalone comment between statements inside a braced body.");
          }
          const owner = block.getFunctionParent();
          if (!owner || !functions.includes(owner) || owner.node.async || owner.node.generator) {
            throw block.buildCodeFrameError("may-yield-here is inside a function excluded from transformation (or outside a function).");
          }
          const entries = directives.get(owner) ?? [];
          entries.push({ block, comment });
          directives.set(owner, entries);
        }
        if (markers.length) {
          // Babel and Recast attach the same comment to different neighboring nodes.
          const removed = new Set(markers);
          t.traverseFast(program.node, (node: any) => {
            for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
              if (node[key]) node[key] = node[key].filter((comment: Types.Comment) => !removed.has(comment));
            }
          });
        }

        // Keep declarations in place unless module initialization may execute code
        // or capture a function before its wrapper has been initialized. Deliberately
        // conservative: do not try to follow indirect calls or getter side effects.
        const wrappedNames = new Set(functions.filter(p => p.isFunctionDeclaration()).map(p => p.node.id?.name));
        function passive(node: Types.Node | null | undefined): boolean {
          if (!node || t.isLiteral(node) && !t.isTemplateLiteral(node) || t.isFunction(node)) return true;
          if (t.isIdentifier(node)) return !wrappedNames.has(node.name);
          if (t.isArrayExpression(node)) return node.elements.every(passive);
          if (t.isObjectExpression(node)) return node.properties.every(p =>
            (t.isObjectMethod(p) && !p.computed) ||
            (t.isObjectProperty(p) && !p.computed && passive(p.value)));
          return false;
        }
        const needsHoisting = program.node.body.some(statement => {
          const node = t.isExportDeclaration(statement) && "declaration" in statement ? statement.declaration : statement;
          if (!node || t.isImportDeclaration(node) || t.isExportNamedDeclaration(node) ||
              t.isExportAllDeclaration(node) || t.isFunctionDeclaration(node) ||
              t.isTSDeclareFunction(node) || t.isTSInterfaceDeclaration(node) || t.isTSTypeAliasDeclaration(node)) return false;
          if (t.isVariableDeclaration(node)) return node.declarations.some(d => !t.isIdentifier(d.id) || !passive(d.init));
          if (t.isClassDeclaration(node)) {
            return !!node.superClass || !!node.decorators?.length || node.body.body.some(member =>
              t.isStaticBlock(member) ||
              "computed" in member && member.computed ||
              "decorators" in member && !!member.decorators?.length ||
              "static" in member && member.static && "value" in member && !!member.value);
          }
          return true;
        });

        function resultType(node: any): Types.TSType {
          const annotation = node.returnType?.typeAnnotation;
          return annotation && t.isTSTypePredicate(annotation)
            ? t.tsBooleanKeyword()
            : annotation ? clone(annotation) : t.tsAnyKeyword();
        }

        function signature(node: any, mode: "sync" | "async" | "generator") {
          usedTypes = true;
          const params = node.params.map((param: any, index: number) => {
            if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
              const name = t.identifier(`arg${index}`);
              if (param.typeAnnotation) name.typeAnnotation = clone(param.typeAnnotation);
              return name;
            }
            if (t.isAssignmentPattern(param)) {
              const left = clone(param.left) as any;
              left.optional = true;
              return left;
            }
            return clone(param);
          });
          const ret = mode === "sync" && node.returnType
            ? clone(node.returnType.typeAnnotation)
            : resultType(node);
          const output = mode === "sync" ? ret : t.tsTypeReference(
            mode === "async" ? t.identifier("Promise") : clone(iterable),
            t.tsTypeParameterInstantiation([ret]),
          );
          return t.tsFunctionType(node.typeParameters ? clone(node.typeParameters) : null, params, t.tsTypeAnnotation(output));
        }

        function overloadType(nodes: any[], mode: "sync" | "async" | "generator") {
          if (nodes.length === 1) return signature(nodes[0], mode);
          return t.tsTypeLiteral(nodes.map(node => {
            const sig = signature(node, mode);
            return t.tsCallSignatureDeclaration(sig.typeParameters, sig.parameters, sig.typeAnnotation);
          }));
        }

        function simpleFunctionType(node: any, existingType?: Types.TSType) {
          usedTypes = usedFunctionType = true;
          if (existingType) {
            return t.tsTypeReference(clone(functionType), t.tsTypeParameterInstantiation(
              ["ReturnType", "Parameters", "ThisParameterType"].map(name =>
                t.tsTypeReference(t.identifier(name), t.tsTypeParameterInstantiation([clone(existingType)]))),
            ));
          }
          const sig = signature(node, "sync");
          let receiver: Types.TSType = t.tsUnknownKeyword();
          const args: Array<Types.TSType | Types.TSNamedTupleMember> = [];
          for (const param of sig.parameters) {
            const annotation = (param.typeAnnotation as Types.TSTypeAnnotation | null)?.typeAnnotation ?? t.tsAnyKeyword();
            if (t.isIdentifier(param) && param.name === "this") {
              receiver = clone(annotation);
              continue;
            }
            if (t.isRestElement(param)) args.push(t.tsRestType(clone(annotation)));
            else args.push(t.tsNamedTupleMember(
              t.isIdentifier(param) ? t.identifier(param.name) : t.identifier(`arg${args.length}`),
              clone(annotation),
              !!param.optional,
            ));
          }
          return t.tsTypeReference(clone(functionType), t.tsTypeParameterInstantiation([
            resultType(node), t.tsTupleType(args), receiver,
          ]));
        }

        function fullSignature(nodes: any[]) {
          const calls = (mode: "sync" | "generator") => nodes.map(node => {
            const sig = signature(node, mode);
            return t.tsCallSignatureDeclaration(sig.typeParameters, sig.parameters, sig.typeAnnotation);
          });
          const metadata = ["sync", "async"].map(mode => {
            const property = t.tsPropertySignature(t.identifier(`${mode}Signature`), t.tsTypeAnnotation(overloadType(nodes, mode as "sync" | "async")));
            property.optional = true;
            return property;
          });
          const property = t.tsPropertySignature(clone(marker), t.tsTypeAnnotation(t.tsTypeLiteral([...calls("generator"), ...metadata])));
          property.computed = true;
          const command = t.tsPropertySignature(t.identifier("command"), t.tsTypeAnnotation(overloadType(nodes, "generator")));
          return t.tsTypeLiteral([...calls("sync"), property, command]);
        }

        function wrap(generator: Types.FunctionExpression, original: any, overloads: any[], declarations: Types.Statement[], implementationName: Types.Identifier) {
          used = true;
          const call = t.callExpression(clone(make), [generator]);
          if (original.returnType || original.typeParameters || overloads.length) {
            usedTypes = true;
            const sigs = overloads.length ? overloads : [original];
            if (overloads.length || sigs.some(node => node.typeParameters?.params.length)) {
              call.typeParameters = t.tsTypeParameterInstantiation([
                fullSignature(sigs),
              ]);
            }
            let implementationResult = resultType(original);
            const containsVoid = (type: Types.TSType): boolean => t.isTSVoidKeyword(type)
              || t.isTSUnionType(type) && type.types.some(containsVoid);
            if (overloads.some(overload => containsVoid(resultType(overload))) && !containsVoid(implementationResult)) {
              implementationResult = t.tsUnionType([implementationResult, t.tsVoidKeyword()]);
            }
            generator.returnType = t.tsTypeAnnotation(t.tsTypeReference(clone(iterable), t.tsTypeParameterInstantiation([implementationResult])));
          }
          if (overloads.length) {
            for (const overload of overloads) {
              const sig = signature(overload, "generator");
              declarations.push(t.tsDeclareFunction(clone(implementationName), sig.typeParameters, sig.parameters, sig.typeAnnotation));
            }
            const implementation = t.functionDeclaration(clone(implementationName), generator.params, generator.body, true);
            implementation.typeParameters = generator.typeParameters ?? null;
            implementation.returnType = generator.returnType ?? null;
            declarations.push(implementation);
            call.arguments = [clone(implementationName)];
          }
          return call;
        }

        function transformCalls(path: NodePath<any>, signal?: Types.Identifier) {
          const body = path.get("body") as NodePath;
          const directSuperCalls: NodePath<Types.CallExpression>[] = [];
          let processingDirectSuper = false;
          const visitor = {
            Function(inner: NodePath) { inner.skip(); },
            Class(inner: NodePath) { inner.skip(); },
            YieldExpression(inner: NodePath) { inner.skip(); },
            CallExpression: {
              exit(call: NodePath<Types.CallExpression>) {
                const node = call.node;
                const info = options.analysis?.calls.get(node.end!);
                const cached = info?.targets?.every(target => options.analysis?.commandTargets?.get(target.file)?.has(target.end));
                const direct = isExplicit(call) || synchronousCalls.has(node) || info?.direct || !!(info?.targets && options.analysis?.commandTargets &&
                  info.targets.every(target => !options.analysis!.commandTargets!.get(target.file)?.has(target.end)));
                const superMethod = t.isMemberExpression(node.callee) && t.isSuper(node.callee.object);
                if (direct && superMethod && !processingDirectSuper) {
                  directSuperCalls.push(call);
                  return;
                }
                if (direct && !superMethod) return;
                if (t.isSuper(node.callee) || t.isImport(node.callee)) return;
                if (t.isIdentifier(node.callee) && node.callee.name === make.name) return;
                if (t.isIdentifier(node.callee) && node.callee.name === "eval") {
                  throw call.buildCodeFrameError("Direct eval is not supported by the scheduler transform.");
                }
                // Imported external functions retain their original calling convention.
                if (t.isIdentifier(node.callee)) {
                  if (!info && !localCalls.has(node)) return;
                }
                let fn = node.callee as Types.Expression;
                let receiver: Types.Expression = t.unaryExpression("void", t.numericLiteral(0));
                let args = node.arguments;
                let applyArgs: Types.Expression | undefined;
                let hasReceiver = false;
                const before: Types.Expression[] = [];
                if (t.isMemberExpression(fn)) {
                  if (t.isSuper(fn.object)) {
                    const cls = path.isClassMethod() ? path.parentPath.parentPath!.node : undefined;
                    if (!(t.isClassDeclaration(cls) || t.isClassExpression(cls)) || !t.isIdentifier(cls.superClass)) {
                      throw call.buildCodeFrameError("Superclass method calls require a named superclass.");
                    }
                    const base = path.node.static ? clone(cls.superClass) : t.memberExpression(clone(cls.superClass), t.identifier("prototype"));
                    fn = t.memberExpression(base, clone(fn.property), fn.computed);
                    receiver = t.thisExpression();
                    hasReceiver = true;
                  } else if (!fn.computed && t.isIdentifier(fn.property) && (fn.property.name === "call" || fn.property.name === "apply")) {
                    const first = node.arguments[0];
                    if (first && t.isSpreadElement(first)) return;
                    receiver = first as Types.Expression ?? receiver;
                    hasReceiver = true;
                    if (fn.property.name === "apply") applyArgs = node.arguments[1] as Types.Expression ?? t.arrayExpression([]);
                    else args = node.arguments.slice(1);
                    fn = fn.object as Types.Expression;
                  } else {
                    const binding = t.isIdentifier(fn.object) ? call.scope.getBinding(fn.object.name) : undefined;
                    const stable = t.isThisExpression(fn.object) || binding?.constant && binding.kind !== "module";
                    if (stable) {
                      receiver = clone(fn.object as Types.Expression);
                      hasReceiver = true;
                    } else {
                      const object = path.scope.generateUidIdentifier("receiver");
                      path.scope.push({ id: clone(object), kind: "let" });
                      before.push(t.assignmentExpression("=", clone(object), fn.object as Types.Expression));
                      receiver = clone(object);
                      hasReceiver = true;
                      // Keep simple property accesses intact so TypeScript retains narrowing.
                      if (!t.isIdentifier(fn.object) && !t.isThisExpression(fn.object)) {
                        fn = t.memberExpression(clone(object), clone(fn.property), fn.computed);
                      }
                    }
                  }
                }
                const dynamic = !direct && !cached && !info?.hasCommand;
                if (!direct && !cached) usedCommands = true;
                if (dynamic) {
                  usedRuntimeMarker = true;
                  usedCommands = true;
                  signal ??= path.scope.generateUidIdentifier("signal");
                  before.unshift(t.logicalExpression("&&",
                    t.memberExpression(clone(signal), t.identifier("shouldYield")),
                    t.yieldExpression(t.callExpression(t.memberExpression(clone(commands), t.identifier("yieldNow")), []), true)));
                  if (!t.isIdentifier(fn)) {
                    const target = path.scope.generateUidIdentifier("callee");
                    path.scope.push({ id: clone(target), kind: "let" });
                    before.push(t.assignmentExpression("=", clone(target), fn));
                    fn = clone(target);
                  }
                }
                let factory: Types.Expression = direct ? fn : cached
                  ? t.memberExpression(fn, t.identifier("command"))
                  : t.callExpression(t.memberExpression(clone(commands), t.identifier("execute")), [fn]);
                if (hasReceiver && !applyArgs) factory = t.callExpression(t.memberExpression(factory, t.identifier("bind")), [receiver]);
                const command = applyArgs
                  ? t.callExpression(t.memberExpression(factory, t.identifier("apply")), [receiver, applyArgs])
                  : t.callExpression(factory, args);
                if (node.typeParameters && !applyArgs) command.typeParameters = clone(node.typeParameters);
                let delegated: Types.Expression = direct ? command : t.yieldExpression(command, true);
                if (dynamic) {
                  const scheduled = path.scope.generateUidIdentifier("scheduled");
                  path.scope.push({ id: clone(scheduled), kind: "let" });
                  // A mutable boolean keeps the callable's original type in both
                  // branches, including unions and functions transformed later.
                  before.push(t.assignmentExpression("=", clone(scheduled), t.binaryExpression("in", clone(marker), clone(fn))));
                  let ordinaryFactory = clone(fn);
                  if (hasReceiver && !applyArgs) ordinaryFactory = t.callExpression(t.memberExpression(ordinaryFactory, t.identifier("bind")), [clone(receiver)]);
                  const ordinary = applyArgs
                    ? t.callExpression(t.memberExpression(ordinaryFactory, t.identifier("apply")), [clone(receiver), clone(applyArgs)])
                    : t.callExpression(ordinaryFactory, args.map(clone));
                  if (node.typeParameters && !applyArgs) ordinary.typeParameters = clone(node.typeParameters);
                  delegated = t.conditionalExpression(clone(scheduled), delegated, ordinary);
                }
                call.replaceWith(before.length ? t.sequenceExpression([...before, delegated]) : delegated);
                call.skip();
              },
            },
            OptionalCallExpression(call: NodePath<Types.OptionalCallExpression>) {
              const node = call.node;
              const info = options.analysis?.calls.get(node.end!);
              if (isExplicit(call) || synchronousCalls.has(node) || info?.direct || (info?.targets && options.analysis?.commandTargets &&
                info.targets.every(target => !options.analysis!.commandTargets!.get(target.file)?.has(target.end)))) return;
              const target = path.scope.generateUidIdentifier("optional");
              path.scope.push({ id: clone(target), kind: "let" });
              let value: Types.Expression;
              let invocation: Types.CallExpression;
              if (node.optional && (t.isMemberExpression(node.callee) || t.isOptionalMemberExpression(node.callee)) && !t.isSuper(node.callee.object)) {
                const member = node.callee;
                const receiver = path.scope.generateUidIdentifier("receiver");
                path.scope.push({ id: clone(receiver), kind: "let" });
                invocation = t.callExpression(t.memberExpression(clone(target), t.identifier("call")), [clone(receiver), ...node.arguments]);
                invocation.end = node.end ?? null;
                if (node.typeParameters) invocation.typeParameters = clone(node.typeParameters);
                localCalls.add(invocation);
                const invoke = t.sequenceExpression([
                  t.assignmentExpression("=", clone(target), t.memberExpression(clone(receiver), clone(member.property), member.computed)),
                  t.conditionalExpression(t.binaryExpression("==", clone(target), t.nullLiteral()), t.unaryExpression("void", t.numericLiteral(0)), invocation),
                ]);
                call.replaceWith(t.sequenceExpression([
                  t.assignmentExpression("=", clone(receiver), member.object),
                  t.isOptionalMemberExpression(member) && member.optional
                    ? t.conditionalExpression(t.binaryExpression("==", clone(receiver), t.nullLiteral()), t.unaryExpression("void", t.numericLiteral(0)), invoke)
                    : invoke,
                ]));
                return;
              } else if (t.isOptionalMemberExpression(node.callee) && node.callee.optional && !node.optional) {
                value = node.callee.object;
                invocation = t.callExpression(t.memberExpression(clone(target), clone(node.callee.property), node.callee.computed), node.arguments);
              } else if (node.optional && (t.isIdentifier(node.callee) || t.isCallExpression(node.callee))) {
                value = node.callee;
                invocation = t.callExpression(clone(target), node.arguments);
              } else {
                throw call.buildCodeFrameError("This optional call needs to be simplified before transformation.");
              }
              invocation.end = node.end ?? null;
              if (node.typeParameters) invocation.typeParameters = clone(node.typeParameters);
              localCalls.add(invocation);
              call.replaceWith(t.sequenceExpression([
                t.assignmentExpression("=", clone(target), value),
                t.conditionalExpression(t.binaryExpression("==", clone(target), t.nullLiteral()), t.unaryExpression("void", t.numericLiteral(0)), invocation),
              ]));
            },
          };
          body.traverse(visitor);
          if (hasYield(path)) {
            processingDirectSuper = true;
            for (const call of directSuperCalls) visitor.CallExpression.exit(call);
          }
          return signal;
        }

        function insertSignal(path: NodePath<any>, signal: Types.Identifier) {
          const body = path.get("body") as NodePath<Types.BlockStatement>;
          const references: NodePath<Types.Identifier>[] = [];
          let needsEagerSignal = false;
          body.traverse({
            Function(inner) { inner.skip(); },
            Class(inner) { inner.skip(); },
            Identifier(reference) {
              if (reference.node.name !== signal.name) return;
              references.push(reference);
              for (let ancestor: NodePath | null = reference.parentPath; ancestor && ancestor !== path; ancestor = ancestor.parentPath) {
                // Acquisition must not become catchable or trigger a finally
                // block that would not have run with acquisition at entry.
                if (ancestor.isTryStatement()) needsEagerSignal = true;
              }
            },
          });
          // A checkpoint reached unconditionally at function level gains nothing
          // from lazy acquisition. Stay conservative about branches and exits.
          function unconditionalStatement(reference: NodePath): NodePath | undefined {
            let current = reference;
            while (!current.parentPath?.isBlockStatement()) {
              const parent = current.parentPath;
              if (!parent || parent.isLoop() || parent.isSwitchCase() ||
                  parent.isIfStatement() && current.key !== "test" ||
                  parent.isConditionalExpression() && current.key !== "test" ||
                  parent.isLogicalExpression() && current.key === "right" ||
                  parent.isAssignmentExpression() && ["&&=", "||=", "??="].includes(parent.node.operator) && current.key === "right" ||
                  parent.isAssignmentExpression() && (t.isObjectPattern(parent.node.left) || t.isArrayPattern(parent.node.left)) ||
                  parent.isVariableDeclarator() && !t.isIdentifier(parent.node.id) ||
                  parent.isOptionalCallExpression() || parent.isOptionalMemberExpression()) return undefined;
              current = parent;
            }
            return current;
          }
          const first = references[0] && unconditionalStatement(references[0]);
          if (first?.parentPath === body) {
            let canExit = false;
            for (const statement of body.get("body")) {
              if (statement === first) break;
              if (statement.isReturnStatement() || statement.isThrowStatement()) canExit = true;
              statement.traverse({
                Function(inner) { inner.skip(); },
                Class(inner) { inner.skip(); },
                "ReturnStatement|ThrowStatement"() { canExit = true; },
              });
            }
            if (!canExit) needsEagerSignal = true;
          }
          const acquisition = () => t.yieldExpression(t.callExpression(
            t.memberExpression(clone(commands), t.identifier("getSignal")), []), true);
          if (needsEagerSignal) {
            body.node.body.unshift(t.variableDeclaration("const", [t.variableDeclarator(clone(signal), acquisition())]));
          } else {
            // For the expressions accepted above, traversal follows evaluation
            // order (destructuring is excluded because its RHS runs first). Once an
            // unconditional checkpoint in a block has run, later references in
            // that block can use the signal directly (including the assignment
            // value after a computed property key).
            const initializedBlocks = new Set<Types.Node>();
            for (const reference of references) {
              const statement = reference.findParent(parent => parent.parentPath?.isBlockStatement() ?? false);
              const block = statement?.parentPath?.node;
              const unconditional = unconditionalStatement(reference);
              if (!block || !initializedBlocks.has(block)) {
                reference.replaceWith(t.assignmentExpression("??=", clone(signal), acquisition()));
              }
              if (unconditional) initializedBlocks.add(unconditional.parentPath!.node);
            }
            body.node.body.unshift(t.variableDeclaration("let", [t.variableDeclarator(clone(signal))]));
          }
        }

        for (const path of functions.reverse()) {
          if (path.removed) continue;
          if (path.node.async) continue;
          const originalBody = path.node.body;
          if (path.isArrowFunctionExpression() && !t.isBlockStatement(originalBody)) {
            path.get("body").replaceWith(t.blockStatement([t.returnStatement(originalBody)]));
          }
          const checkpoints = directives.get(path);
          let signal: Types.Identifier | undefined;
          if (checkpoints) {
            usedCommands = true;
            signal = path.scope.generateUidIdentifier("signal");
            for (const { block, comment } of [...checkpoints].reverse()) {
              const check = t.ifStatement(t.memberExpression(clone(signal), t.identifier("shouldYield")), t.blockStatement([
                t.expressionStatement(t.yieldExpression(t.callExpression(t.memberExpression(clone(commands), t.identifier("yieldNow")), []), true)),
              ]));
              const index = block.node.body.findIndex(statement => statement.start! > comment.end!);
              block.node.body.splice(index < 0 ? block.node.body.length : index, 0, check);
            }
          }
          signal = transformCalls(path, signal);
          if (signal) insertSignal(path, signal);
          if (!hasYield(path) && !optedIn.has(path.node)) {
            path.node.body = originalBody;
            continue;
          }
          if (path.isClassPrivateMethod()) {
            throw path.buildCodeFrameError("Private methods are not supported by the scheduler transform yet.");
          }
          path.traverse({
            Function(inner) { inner.skip(); },
            Class(inner) { inner.skip(); },
            NewExpression(constructor) {
              const type = options.analysis?.constructors.get(constructor.node.end!);
              if (!type) return;
              const parsed = parseSignature(`() => ${type}`).typeAnnotation!.typeAnnotation;
              if (t.isTSTypeReference(parsed) && parsed.typeParameters) constructor.node.typeParameters = parsed.typeParameters;
            },
          });
          const info = options.analysis?.functions.get(path.node.end!);
          if (info?.signature) {
            const sig = parseSignature(info.signature);
            if (!path.node.returnType && sig.typeAnnotation) path.node.returnType = clone(sig.typeAnnotation);
            const params = sig.parameters.filter(p => !t.isIdentifier(p, { name: "this" }));
            path.node.params.forEach((param: any, index: number) => {
              const target = t.isAssignmentPattern(param) ? param.left : param;
              let annotation = (params[index] as any)?.typeAnnotation;
              if (t.isRestElement(param)) annotation = t.tsTypeAnnotation(t.tsTupleType(params.slice(index).map(p => clone((p as any).typeAnnotation.typeAnnotation))));
              if (!target.typeAnnotation && annotation) target.typeAnnotation = clone(annotation);
            });
          }
          if (path.isArrowFunctionExpression()) path.arrowFunctionToExpression();
          const original = clone(path.node) as any;
          const overloadPaths: NodePath<any>[] = [];
          if (path.isFunctionDeclaration() && path.node.id) {
            const container = path.parentPath.isExportDeclaration() ? path.parentPath.parentPath : path.parentPath;
            for (const sibling of container.get("body") as NodePath<any>[]) {
              const declaration = sibling.isExportNamedDeclaration() ? sibling.get("declaration") as NodePath<any> : sibling;
              if (declaration?.isTSDeclareFunction() && declaration.node.id?.name === path.node.id.name) overloadPaths.push(declaration);
            }
          } else if (path.isClassMethod()) {
            for (const sibling of path.parentPath.get("body") as NodePath<any>[]) {
              if (sibling.isTSDeclareMethod() && sibling.node.static === path.node.static && t.isNodesEquivalent(sibling.node.key, path.node.key)) overloadPaths.push(sibling);
            }
          }
          const overloads = overloadPaths.map(p => clone(p.node));
          options.analysis?.transformed?.add(path.node.end!);
          for (const overload of overloadPaths) options.analysis?.transformed?.add(overload.node.end!);
          const commentSources = [...overloadPaths, path].flatMap(p =>
            p.parentPath!.isExportDeclaration() ? [p.parentPath!.node, p.node] : [p.node]);
          // Moving this body can change indentation. Reprint its template contents
          // verbatim, but leave templates in untouched functions alone.
          t.traverseFast(path.node.body, node => {
            if (!t.isTemplateLiteral(node)) return;
            Object.defineProperty(node, "original", { value: null });
            for (const quasi of node.quasis) Object.defineProperty(quasi, "original", { value: null });
          });
          const generator = t.functionExpression(null, path.node.params, path.node.body, true, false);
          generator.typeParameters = path.node.typeParameters;
          let implementation = original;
          let implementationThisType: Types.TSType | undefined;
          const implementations: Types.Statement[] = [];
          if (path.isClassMethod()) {
            const cls = path.parentPath.parentPath!.node as Types.ClassDeclaration;
            if (cls.id && (options.analysis || original.returnType || original.typeParameters || original.params.some((p: any) => p.typeAnnotation))) {
              const params = (cls.typeParameters as Types.TSTypeParameterDeclaration)?.params ?? [];
              const thisType = path.node.static ? t.tsTypeQuery(clone(cls.id)) : t.tsTypeReference(clone(cls.id), params.length ? t.tsTypeParameterInstantiation(params.map(p => t.tsTypeReference(t.identifier(p.name)))) : null);
              implementationThisType = thisType;
              const thisParam = t.identifier("this");
              thisParam.typeAnnotation = t.tsTypeAnnotation(thisType);
              if (!generator.params.some(p => t.isIdentifier(p, { name: "this" }))) generator.params.unshift(thisParam);
              implementation = { ...implementation, params: generator.params };
            }
          }
          const implementationName = path.scope.generateUidIdentifier(`${original.id?.name ?? original.key?.name ?? "function"}Impl`);
          const wrapped = wrap(generator, implementation, overloads, implementations, implementationName);
          const existingAnnotation = path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)
            ? path.parentPath.node.id.typeAnnotation
            : path.parentPath?.isClassProperty() ? path.parentPath.node.typeAnnotation : undefined;
          const explicitSimpleType = options.typeImportResolutionMode && !path.isClassMethod()
            && !overloads.length && !original.typeParameters?.params.length && original.returnType
            ? simpleFunctionType(original, t.isTSTypeAnnotation(existingAnnotation) ? existingAnnotation.typeAnnotation : undefined) : undefined;
          if (path.isClassMethod()) wrapped.typeParameters = null;
          if (implementationThisType) {
            const names = new Set<string>();
            const generated = t.file(t.program([...implementations, t.expressionStatement(wrapped)]));
            t.traverseFast(generated, node => {
              if (t.isIdentifier(node)) names.add(node.name);
              if (t.isTSTypeParameter(node)) names.add(node.name);
            });
            let name = "This";
            for (let suffix = 2; names.has(name); suffix++) name = `This${suffix}`;
            let replaced = false;
            traverse(generated, {
              noScope: true,
              Class(inner) { inner.skip(); },
              TSInterfaceDeclaration(inner) { inner.skip(); },
              TSThisType(inner) {
                inner.replaceWith(t.tsTypeReference(t.identifier(name)));
                replaced = true;
              },
            });
            if (replaced) implementations.push(t.tsTypeAliasDeclaration(t.identifier(name), null, clone(implementationThisType)));
          }
          for (const overload of overloadPaths) {
            if (overload.parentPath!.isExportNamedDeclaration()) overload.parentPath!.remove();
            else overload.remove();
          }

          if (path.isFunctionDeclaration()) {
            const name = path.node.id ?? path.scope.generateUidIdentifier("default");
            const exported = path.parentPath.isExportDeclaration();
            const statement = exported ? path.parentPath : path;
            const container = statement.parentPath!;
            // Opted-in local declarations can be called before their definition,
            // including from callbacks returned before that definition.
            const hoist = needsHoisting || !container.isProgram();
            const declaration = t.variableDeclaration("var", [t.variableDeclarator(clone(name), wrapped)]);
            if (explicitSimpleType) {
              (declaration.declarations[0]!.id as Types.Identifier).typeAnnotation = t.tsTypeAnnotation(explicitSimpleType);
            }
            if (hoist || !statement.isExportNamedDeclaration()) {
              preserveComments(declaration, ...commentSources);
            }
            // The comments move with the declaration. Do not let Babel also
            // attach them to an untouched neighboring statement when removing it.
            t.removeComments(statement.node);
            if (hoist) {
              const list = hoisted.get(container) ?? [];
              list.unshift(...implementations, declaration);
              hoisted.set(container, list);
              if (statement.isExportDefaultDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), t.identifier("default"))]));
              else if (statement.isExportNamedDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), clone(name))]));
              else statement.remove();
            } else if (statement.isExportDefaultDeclaration()) {
              statement.replaceWithMultiple([...implementations, declaration, t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), t.identifier("default"))])]);
            } else {
              const replacement = statement.isExportNamedDeclaration() ? t.exportNamedDeclaration(declaration) : declaration;
              if (statement.isExportNamedDeclaration()) preserveComments(replacement, ...commentSources);
              statement.replaceWithMultiple([...implementations, replacement]);
            }
          } else if (path.isObjectMethod()) {
            path.replaceWith(t.objectProperty(clone(path.node.key), wrapped, path.node.computed));
          } else if (path.isClassMethod()) {
            const classBody = path.parentPath as NodePath<Types.ClassBody>;
            const method = path.node;
            if (method.computed && !t.isStringLiteral(method.key)) {
              throw path.buildCodeFrameError("Computed class methods are not supported by the scheduler transform yet.");
            }
            const target = method.static ? t.thisExpression() : t.memberExpression(t.thisExpression(), t.identifier("prototype"));
            const key = t.isIdentifier(method.key) ? t.stringLiteral(method.key.name) : clone(method.key);
            const definition = t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("defineProperty")), [
              target, key as Types.Expression,
              t.objectExpression([
                t.objectProperty(t.identifier("value"), wrapped),
                t.objectProperty(t.identifier("writable"), t.booleanLiteral(true)),
                t.objectProperty(t.identifier("configurable"), t.booleanLiteral(true)),
              ]),
            ]));
            const installationBody = [...implementations, definition];
            const classParameters = (classBody.parentPath!.node as Types.ClassDeclaration).typeParameters as Types.TSTypeParameterDeclaration | null;
            const initialize = t.arrowFunctionExpression([], t.blockStatement(installationBody));
            if (classParameters) initialize.typeParameters = clone(classParameters);
            const installation = t.staticBlock(classParameters?.params.length
              ? [t.expressionStatement(t.callExpression(initialize, []))]
              : installationBody);
            const hoist = classesWithStaticInitialization.has(classBody.node);
            if (original.returnType || original.typeParameters || original.params.some((p: any) => p.typeAnnotation)) {
              const signatures = overloads.length ? overloads : [original];
              const property = t.classProperty(clone(method.key));
              property.declare = true;
              property.static = method.static;
              const shape = fullSignature(signatures);
              const complex = overloads.length > 0 || signatures.some(node => node.typeParameters?.params.length);
              let hasThisType = false;
              const names = new Set<string>();
              t.traverseFast(shape, node => {
                if (t.isTSThisType(node)) hasThisType = true;
                if (t.isIdentifier(node)) names.add(node.name);
                if (t.isTSTypeParameter(node)) names.add(node.name);
              });
              const simpleType = (sig: Types.TSCallSignatureDeclaration) => {
                usedMethodType = true;
                return t.tsTypeReference(clone(methodType), t.tsTypeParameterInstantiation([
                  t.tsFunctionType(sig.typeParameters, sig.parameters, sig.typeAnnotation),
                ]));
              };
              if (complex || hasThisType) {
                const cls = classBody.parentPath as NodePath<Types.ClassDeclaration>;
                if (!cls.isClassDeclaration() || !cls.node.id) {
                  throw path.buildCodeFrameError("Generic, overloaded, and polymorphic this method signatures require a named class declaration.");
                }
                const params = method.static ? [] : (cls.node.typeParameters as Types.TSTypeParameterDeclaration)?.params ?? [];
                for (const param of params) names.add(param.name);
                let self = "This";
                for (let suffix = 2; names.has(self); suffix++) self = `This${suffix}`;
                if (hasThisType) {
                  traverse(t.file(t.program([t.tsTypeAliasDeclaration(t.identifier("Signature"), null, shape)])), {
                    noScope: true,
                    TSThisType(inner) { inner.replaceWith(t.tsTypeReference(t.identifier(self))); },
                  });
                }
                const reservedTypeNames = new Set(["any", "unknown", "never", "number", "string", "boolean", "bigint", "symbol", "object", "undefined", "void", "intrinsic"]);
                const methodName = t.isIdentifier(method.key) && !method.static
                  && t.isValidIdentifier(method.key.name) && !reservedTypeNames.has(method.key.name)
                  ? clone(method.key) : path.scope.generateUidIdentifier(t.isIdentifier(method.key) ? method.key.name : "method");
                const typeParams = [...(hasThisType ? [t.tsTypeParameter(null, null, self)] : []), ...params.map(clone)];
                const declarationParams = () => typeParams.length ? t.tsTypeParameterDeclaration(typeParams.map(clone)) : null;
                const argumentsFor = () => typeParams.length ? t.tsTypeParameterInstantiation(typeParams.map(param => t.tsTypeReference(t.identifier(param.name)))) : null;
                const reference = (name: Types.Identifier) => t.tsTypeReference(clone(name), argumentsFor());
                const declarations: Types.Statement[] = [];
                const calls = shape.members.filter(t.isTSCallSignatureDeclaration);
                if (!complex) {
                  declarations.push(t.tsTypeAliasDeclaration(clone(methodName), declarationParams(), simpleType(calls[0]!)));
                } else {
                  const syncName = program.scope.generateUidIdentifier(`${methodName.name}Sync`);
                  const generatorName = program.scope.generateUidIdentifier(`${methodName.name}Generator`);
                  const implementationName = program.scope.generateUidIdentifier(`${methodName.name}Implementation`);
                  const markerProperty = shape.members.find(t.isTSPropertySignature)!;
                  const markerShape = markerProperty.typeAnnotation!.typeAnnotation as Types.TSTypeLiteral;
                  const methods = (callSignatures: Types.TSCallSignatureDeclaration[], name: string, optional = false) =>
                    callSignatures.map(sig => {
                      const method = t.tsMethodSignature(t.identifier(name), sig.typeParameters ? clone(sig.typeParameters) : null, sig.parameters.map(clone), sig.typeAnnotation ? clone(sig.typeAnnotation) : null);
                      method.optional = optional;
                      return method;
                    });
                  const methodAlias = (name: Types.Identifier, callSignatures: Types.TSCallSignatureDeclaration[]) =>
                    t.tsTypeAliasDeclaration(clone(name), declarationParams(), t.tsIndexedAccessType(
                      t.tsTypeLiteral(methods(callSignatures, "invoke")), t.tsLiteralType(t.stringLiteral("invoke"))));
                  declarations.push(methodAlias(syncName, calls));
                  declarations.push(methodAlias(generatorName, markerShape.members.filter(t.isTSCallSignatureDeclaration)));
                  const metadata = markerShape.members.filter(t.isTSPropertySignature).flatMap(property => {
                    const type = property.typeAnnotation!.typeAnnotation;
                    const signatures = t.isTSFunctionType(type)
                      ? [t.tsCallSignatureDeclaration(type.typeParameters, type.parameters, type.typeAnnotation)]
                      : (type as Types.TSTypeLiteral).members as Types.TSCallSignatureDeclaration[];
                    return methods(signatures, (property.key as Types.Identifier).name, true);
                  });
                  declarations.push(t.tsInterfaceDeclaration(clone(implementationName), declarationParams(),
                    [t.tsExpressionWithTypeArguments(clone(generatorName), argumentsFor())], t.tsInterfaceBody(metadata)));
                  const markerMember = t.tsPropertySignature(clone(marker), t.tsTypeAnnotation(reference(implementationName)));
                  markerMember.computed = true;
                  const commandMember = t.tsPropertySignature(t.identifier("command"), t.tsTypeAnnotation(reference(generatorName)));
                  declarations.push(t.tsInterfaceDeclaration(clone(methodName), declarationParams(),
                    [t.tsExpressionWithTypeArguments(clone(syncName), argumentsFor())], t.tsInterfaceBody([markerMember, commandMember])));
                }
                const existing = signatureNamespaces.get(cls) ?? [];
                existing.unshift(...declarations);
                signatureNamespaces.set(cls, existing);
                const args = [...(hasThisType ? [t.tsThisType()] : []), ...params.map(param => t.tsTypeReference(t.identifier(param.name)))];
                property.typeAnnotation = t.tsTypeAnnotation(t.tsTypeReference(
                  t.tsQualifiedName(t.tsQualifiedName(clone(cls.node.id), t.identifier("Signatures")), clone(methodName)),
                  args.length ? t.tsTypeParameterInstantiation(args) : null));
              } else {
                property.typeAnnotation = t.tsTypeAnnotation(simpleType(shape.members[0] as Types.TSCallSignatureDeclaration));
              }
              preserveComments(property, ...commentSources);
              path.replaceWithMultiple(hoist ? [property] : [property, installation]);
            } else {
              preserveComments(definition, ...commentSources);
              if (hoist) path.remove();
              else path.replaceWith(installation);
            }
            // Install prototype methods before static field initializers run.
            if (hoist) classBody.unshiftContainer("body", installation);
          } else {
            if (explicitSimpleType) {
              if (path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)) {
                path.parentPath.node.id.typeAnnotation = t.tsTypeAnnotation(explicitSimpleType);
              } else if (path.parentPath?.isClassProperty()) {
                path.parentPath.node.typeAnnotation = t.tsTypeAnnotation(explicitSimpleType);
              } else {
                wrapped.typeParameters = t.tsTypeParameterInstantiation([explicitSimpleType]);
              }
            }
            if (path.isObjectMethod()) {
              const property = t.objectProperty(clone(path.node.key), wrapped, path.node.computed);
              preserveComments(property, ...commentSources);
              path.replaceWith(property);
            } else {
              path.replaceWith(wrapped);
            }
          }
        }

        for (const [cls, interfaces] of signatureNamespaces) {
          const signatures = t.tsModuleDeclaration(t.identifier("Signatures"), t.tsModuleBlock(interfaces));
          signatures.kind = "namespace";
          const namespace = t.tsModuleDeclaration(clone(cls.node.id), t.tsModuleBlock([signatures]));
          namespace.kind = "namespace";
          namespace.declare = true;
          if (cls.parentPath!.isExportNamedDeclaration()) cls.parentPath!.insertBefore(t.exportNamedDeclaration(namespace));
          else cls.insertBefore(namespace);
        }

        for (const [container, declarations] of hoisted) {
          (container as NodePath<Types.BlockStatement>).unshiftContainer("body", declarations);
        }
        if (used) {
          program.unshiftContainer("body", t.importDeclaration([
            t.importSpecifier(clone(make), t.identifier("makeSchedulable")),
            ...(usedCommands ? [t.importSpecifier(clone(commands), t.identifier("commands"))] : []),
            ...(usedRuntimeMarker ? [t.importSpecifier(clone(marker), t.identifier("schedulableImplementationSignal"))] : []),
          ], t.stringLiteral(options.runtimeModule ?? "@phryneas/schedule")));
        }
        if (usedTypes) {
          const declaration = t.importDeclaration([
            t.importSpecifier(clone(iterable), t.identifier("SchedulableIterable")),
            ...(!usedRuntimeMarker ? [t.importSpecifier(clone(marker), t.identifier("schedulableImplementationSignal"))] : []),
            ...(usedMethodType ? [t.importSpecifier(clone(methodType), t.identifier("SchedulableMethod"))] : []),
            ...(usedFunctionType ? [t.importSpecifier(clone(functionType), t.identifier("SchedulableFunction"))] : []),
          ], t.stringLiteral(options.runtimeModule ?? "@phryneas/schedule"));
          declaration.importKind = "type";
          if (options.typeImportResolutionMode) {
            // Recast prints import attributes through its legacy assertions field.
            Object.assign(declaration, {
              assertions: [t.importAttribute(
                t.stringLiteral("resolution-mode"),
                t.stringLiteral(options.typeImportResolutionMode),
              )],
              importAttributesKeyword: "with",
            });
          }
          program.unshiftContainer("body", declaration);
        }
      },
    },
  };
}
