import { parseSync } from "@babel/core";
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
      Program(program) {
        const make = program.scope.generateUidIdentifier("makeSchedulable");
        const commands = program.scope.generateUidIdentifier("commands");
        const iterable = program.scope.generateUidIdentifier("SchedulableIterable");
        const marker = program.scope.generateUidIdentifier("schedulableImplementationSignal");
        const functions: NodePath<any>[] = [];
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

        function hasWork(path: NodePath<any>): boolean {
          let found = false;
          path.traverse({
            Function(inner) { inner.skip(); },
            Class(inner) { inner.skip(); },
            Loop() { found = true; },
            CallExpression() { found = true; },
            OptionalCallExpression() { found = true; },
            NewExpression() { found = true; },
            TaggedTemplateExpression() { found = true; },
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
          NewExpression(path) {
            const type = options.analysis?.constructors.get(path.node.end!);
            if (type) {
              const parsed = parseSignature(`() => ${type}`).typeAnnotation!.typeAnnotation;
              if (t.isTSTypeReference(parsed) && parsed.typeParameters) path.node.typeParameters = parsed.typeParameters;
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
            if (!hasWork(path)) {
              return;
            }
            if (path.isClassPrivateMethod()) {
              throw path.buildCodeFrameError("Private methods are not supported by the scheduler transform yet.");
            }
            if ((path.isClassMethod() || path.isObjectMethod()) && path.node.kind !== "method") return;
            if (info?.signature && !path.node.async) {
              const sig = parseSignature(info.signature);
              const params = sig.parameters.filter(p => !t.isIdentifier(p, { name: "this" }));
              path.node.params.forEach((param, index) => {
                const target = t.isAssignmentPattern(param) ? param.left : param;
                let annotation = (params[index] as any)?.typeAnnotation;
                if (t.isRestElement(param)) {
                  annotation = t.tsTypeAnnotation(t.tsTupleType(params.slice(index).map(p => clone((p as any).typeAnnotation.typeAnnotation))));
                }
                if (!(target as any).typeAnnotation && annotation) (target as any).typeAnnotation = clone(annotation);
              });
            }
            if (path.node.body) functions.push(path);
          },
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
          body.traverse({
            Function(inner) { inner.skip(); },
            Class(inner) { inner.skip(); },
            CallExpression: {
              exit(call) {
                const node = call.node;
                const info = options.analysis?.calls.get(node.end!);
                const superMethod = t.isMemberExpression(node.callee) && t.isSuper(node.callee.object);
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
            OptionalCallExpression(call) {
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
          });
        }

        for (const path of functions.reverse()) {
          if (path.removed) continue;
          if (path.node.async) continue;
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
          transformCalls(path);
          const generator = t.functionExpression(null, path.node.params, path.node.body, true, false);
          generator.typeParameters = path.node.typeParameters;
          let implementation = original;
          let implementationOverloads = overloads;
          if (path.isClassMethod()) {
            const cls = path.parentPath.parentPath!.node as Types.ClassDeclaration;
            if (cls.id && (options.analysis || original.returnType || original.typeParameters || original.params.some((p: any) => p.typeAnnotation))) {
              const params = (cls.typeParameters as Types.TSTypeParameterDeclaration)?.params ?? [];
              const thisType = path.node.static ? t.tsTypeQuery(clone(cls.id)) : t.tsTypeReference(clone(cls.id), params.length ? t.tsTypeParameterInstantiation(params.map(p => t.tsTypeReference(t.identifier(p.name)))) : null);
              const thisParam = t.identifier("this");
              thisParam.typeAnnotation = t.tsTypeAnnotation(thisType);
              if (!generator.params.some(p => t.isIdentifier(p, { name: "this" }))) generator.params.unshift(thisParam);
              if (params.length) {
                const generics = t.tsTypeParameterDeclaration([...params.map(clone), ...((generator.typeParameters as Types.TSTypeParameterDeclaration)?.params ?? [])]);
                generator.typeParameters = generics;
                implementation = { ...original, typeParameters: generics };
                implementationOverloads = overloads.map(o => ({ ...o, typeParameters: t.tsTypeParameterDeclaration([...params.map(clone), ...(o.typeParameters?.params ?? [])]) }));
              }
              implementation = { ...implementation, params: generator.params };
            }
          }
          const implementations: Types.Statement[] = [];
          const implementationName = path.scope.generateUidIdentifier(`${original.id?.name ?? original.key?.name ?? "function"}Impl`);
          const wrapped = wrap(generator, implementation, implementationOverloads, implementations, implementationName);
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
            const list = hoisted.get(container) ?? [];
            list.unshift(...implementations, declaration);
            hoisted.set(container, list);
            if (statement.isExportDefaultDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), t.identifier("default"))]));
            else if (statement.isExportNamedDeclaration()) statement.replaceWith(t.exportNamedDeclaration(null, [t.exportSpecifier(clone(name), clone(name))]));
            else statement.remove();
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
            if (original.returnType || original.typeParameters || original.params.some((p: any) => p.typeAnnotation)) {
              const signatures = overloads.length ? overloads : [original];
              const property = t.classProperty(clone(method.key));
              property.declare = true;
              property.static = method.static;
              property.typeAnnotation = t.tsTypeAnnotation(fullSignature(signatures));
              preserveComments(property, ...commentSources);
              path.replaceWith(property);
            } else {
              preserveComments(definition, ...commentSources);
              path.remove();
            }
            // Install prototype methods before static field initializers run.
            classBody.unshiftContainer("body", t.staticBlock([...implementations, definition]));
          } else {
            path.replaceWith(wrapped);
          }
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
