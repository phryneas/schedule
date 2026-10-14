import { parseSync, traverse } from "@babel/core";
import type { NodePath, PluginObj } from "@babel/core";
import type * as Types from "@babel/types";
import type { SourceAnalysis } from "./analyze.ts";

export interface SchedulerPluginOptions {
  /** Import path for the scheduler runtime. */
  runtimeModule?: string;
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
        const functions: NodePath<any>[] = [];
        const signatureNamespaces = new Map<NodePath<any>, Types.TSInterfaceDeclaration[]>();
        const classesWithStaticInitialization = new WeakSet<Types.ClassBody>();
        const hoisted = new Map<NodePath<any>, Types.Statement[]>();
        const localCalls = new WeakSet<Types.CallExpression>();
        let used = false;
        let usedTypes = false;
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
            if (!eligibleScope(path)) return;
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
          return t.tsTypeLiteral([...calls("sync"), property]);
        }

        function wrap(generator: Types.FunctionExpression, original: any, overloads: any[], declarations: Types.Statement[], implementationName: Types.Identifier) {
          used = true;
          const call = t.callExpression(clone(make), [generator]);
          if (original.returnType || original.typeParameters || overloads.length) {
            const sigs = overloads.length ? overloads : [original];
            call.typeParameters = t.tsTypeParameterInstantiation([
              fullSignature(sigs),
            ]);
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

        function transformCalls(path: NodePath<any>) {
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
                const superMethod = t.isMemberExpression(node.callee) && t.isSuper(node.callee.object);
                if (info?.direct && superMethod && !processingDirectSuper) {
                  directSuperCalls.push(call);
                  return;
                }
                if (info?.direct && !superMethod) return;
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
                let factory: Types.Expression = info?.direct ? fn : t.callExpression(t.memberExpression(clone(commands), t.identifier("execute")), [fn]);
                if (hasReceiver && !applyArgs) factory = t.callExpression(t.memberExpression(factory, t.identifier("bind")), [receiver]);
                const command = applyArgs
                  ? t.callExpression(t.memberExpression(factory, t.identifier("apply")), [receiver, applyArgs])
                  : t.callExpression(factory, args);
                if (node.typeParameters && !applyArgs) command.typeParameters = clone(node.typeParameters);
                const delegated = info?.direct ? command : t.yieldExpression(command, true);
                call.replaceWith(before.length ? t.sequenceExpression([...before, delegated]) : delegated);
                call.skip();
              },
            },
            OptionalCallExpression(call: NodePath<Types.OptionalCallExpression>) {
              const node = call.node;
              if (options.analysis?.calls.get(node.end!)?.direct) return;
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
        }

        for (const path of functions.reverse()) {
          if (path.removed) continue;
          if (path.node.async) continue;
          const originalBody = path.node.body;
          if (path.isArrowFunctionExpression() && !t.isBlockStatement(originalBody)) {
            path.get("body").replaceWith(t.blockStatement([t.returnStatement(originalBody)]));
          }
          const checkpoints = directives.get(path);
          if (checkpoints) {
            const signal = path.scope.generateUidIdentifier("signal");
            for (const { block, comment } of [...checkpoints].reverse()) {
              const check = t.ifStatement(t.memberExpression(clone(signal), t.identifier("shouldYield")), t.blockStatement([
                t.expressionStatement(t.yieldExpression(t.callExpression(t.memberExpression(clone(commands), t.identifier("yieldNow")), []), true)),
              ]));
              const index = block.node.body.findIndex(statement => statement.start! > comment.end!);
              block.node.body.splice(index < 0 ? block.node.body.length : index, 0, check);
            }
            path.node.body.body.unshift(t.variableDeclaration("const", [t.variableDeclarator(clone(signal),
              t.yieldExpression(t.callExpression(t.memberExpression(clone(commands), t.identifier("getSignal")), []), true))]));
          }
          transformCalls(path);
          if (!hasYield(path)) {
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
              for (const param of params) {
                implementations.push(t.tsTypeAliasDeclaration(t.identifier(param.name), null,
                  param.default ? clone(param.default) : param.constraint ? clone(param.constraint) : t.tsUnknownKeyword()));
              }
              implementation = { ...implementation, params: generator.params };
            }
          }
          const implementationName = path.scope.generateUidIdentifier(`${original.id?.name ?? original.key?.name ?? "function"}Impl`);
          const wrapped = wrap(generator, implementation, overloads, implementations, implementationName);
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
            const declaration = t.variableDeclaration("var", [t.variableDeclarator(clone(name), wrapped)]);
            preserveComments(declaration, ...commentSources);
            // The comments move with the declaration. Do not let Babel also
            // attach them to an untouched neighboring statement when removing it.
            t.removeComments(statement.node);
            if (needsHoisting) {
              const list = hoisted.get(container) ?? [];
              list.unshift(...implementations, declaration);
              hoisted.set(container, list);
              if (statement.isExportDefaultDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), t.identifier("default"))]));
              else if (statement.isExportNamedDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), clone(name))]));
              else statement.remove();
            } else if (statement.isExportDefaultDeclaration()) {
              statement.replaceWithMultiple([...implementations, declaration, t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), t.identifier("default"))])]);
            } else {
              statement.replaceWithMultiple([...implementations, statement.isExportNamedDeclaration() ? t.exportNamedDeclaration(declaration) : declaration]);
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
            const installation = t.staticBlock([...implementations, definition]);
            const hoist = classesWithStaticInitialization.has(classBody.node);
            if (original.returnType || original.typeParameters || original.params.some((p: any) => p.typeAnnotation)) {
              const signatures = overloads.length ? overloads : [original];
              const property = t.classProperty(clone(method.key));
              property.declare = true;
              property.static = method.static;
              const signature = fullSignature(signatures);
              let hasThisType = false;
              const names = new Set<string>();
              t.traverseFast(signature, node => {
                if (t.isTSThisType(node)) hasThisType = true;
                if (t.isIdentifier(node)) names.add(node.name);
                if (t.isTSTypeParameter(node)) names.add(node.name);
              });
              if (hasThisType) {
                const cls = classBody.parentPath as NodePath<Types.ClassDeclaration>;
                if (!cls.isClassDeclaration() || !cls.node.id) {
                  throw path.buildCodeFrameError("Polymorphic this signatures require a named class declaration.");
                }
                const params = (cls.node.typeParameters as Types.TSTypeParameterDeclaration)?.params ?? [];
                for (const param of params) names.add(param.name);
                let self = "This";
                for (let suffix = 2; names.has(self); suffix++) self = `This${suffix}`;
                traverse(t.file(t.program([t.tsTypeAliasDeclaration(t.identifier("Signature"), null, signature)])), {
                  noScope: true,
                  TSThisType(inner) { inner.replaceWith(t.tsTypeReference(t.identifier(self))); },
                });
                const methodName = t.isIdentifier(method.key) ? clone(method.key) : path.scope.generateUidIdentifier("method");
                const iface = t.tsInterfaceDeclaration(methodName,
                  t.tsTypeParameterDeclaration([t.tsTypeParameter(null, null, self), ...params.map(clone)]),
                  [], t.tsInterfaceBody(signature.members));
                const interfaces = signatureNamespaces.get(cls) ?? [];
                interfaces.unshift(iface);
                signatureNamespaces.set(cls, interfaces);
                property.typeAnnotation = t.tsTypeAnnotation(t.tsTypeReference(
                  t.tsQualifiedName(t.tsQualifiedName(clone(cls.node.id), t.identifier("Signatures")), clone(methodName)),
                  t.tsTypeParameterInstantiation([t.tsThisType(), ...params.map(param => t.tsTypeReference(t.identifier(param.name)))])));
              } else {
                property.typeAnnotation = t.tsTypeAnnotation(signature);
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
            path.replaceWith(wrapped);
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
            t.importSpecifier(clone(commands), t.identifier("commands")),
          ], t.stringLiteral(options.runtimeModule ?? "@phryneas/schedule")));
        }
        if (usedTypes) {
          const declaration = t.importDeclaration([
            t.importSpecifier(clone(iterable), t.identifier("SchedulableIterable")),
            t.importSpecifier(clone(marker), t.identifier("schedulableImplementationSignal")),
          ], t.stringLiteral(options.runtimeModule ?? "@phryneas/schedule"));
          declaration.importKind = "type";
          program.unshiftContainer("body", declaration);
        }
      },
    },
  };
}
