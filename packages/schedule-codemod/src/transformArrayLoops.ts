import type { NodePath, PluginObj } from "@babel/core";
import type * as Types from "@babel/types";

/** Explicit opt-in for dense arrays whose iteration structure is not mutated. */
export default function transformArrayLoops(api: { types: typeof Types }): PluginObj {
  const t = api.types;
  const directive = "@phryneas/schedule transform-to-loop";
  return {
    name: "schedule-array-loops",
    visitor: {
      Program(program, state) {
        const comments = new Set<Types.Comment>(state.file.ast.comments ?? []);
        t.traverseFast(program.node, (node: any) => {
          for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
            for (const comment of node[key] ?? []) comments.add(comment);
          }
        });
        for (const comment of comments) {
          if (comment.value.trim() !== directive) continue;
          let target: NodePath<Types.ReturnStatement | Types.VariableDeclaration> | undefined;
          program.traverse({
            "ReturnStatement|VariableDeclaration"(path: NodePath<any>) {
              if (path.node.leadingComments?.some((c: Types.Comment) => c.start === comment.start && c.end === comment.end)) target = path;
            },
          });
          const fail = (message: string): never => {
            throw (target ?? program).buildCodeFrameError(`transform-to-loop: ${message}`);
          };
          if (!target || !target.inList || !target.parentPath?.isBlockStatement()) {
            fail("place the marker before a return or single-variable declaration inside a braced body.");
          }
          const statement = target!;
          let call: NodePath | undefined;
          if (statement.isReturnStatement()) call = statement.get("argument") as NodePath;
          else if (statement.isVariableDeclaration()) {
            if (statement.node.declarations.length !== 1 || !t.isIdentifier(statement.node.declarations[0]!.id)) {
              fail("only single-variable declarations with an identifier are supported.");
            }
            call = statement.get("declarations.0.init") as NodePath;
          } else fail("unsupported statement.");
          if (!call?.isCallExpression() || !t.isMemberExpression(call.node.callee)
            || call.node.callee.computed || !t.isIdentifier(call.node.callee.property)
            || !["map", "some"].includes(call.node.callee.property.name)) {
            fail("expected a direct .map(...) or .some(...) call.");
          }
          const invocation = call as NodePath<Types.CallExpression>;
          const member = invocation.node.callee as Types.MemberExpression;
          const method = (member.property as Types.Identifier).name;
          if (invocation.node.arguments.length !== 1) fail("thisArg and additional arguments are not supported.");
          const callback = invocation.get("arguments.0") as NodePath;
          if (!(callback.isArrowFunctionExpression() || callback.isFunctionExpression())) {
            fail("the callback must be an inline arrow or function expression.");
          }
          const fn = callback as NodePath<Types.ArrowFunctionExpression | Types.FunctionExpression>;
          if (fn.node.async || fn.node.generator || fn.node.typeParameters) fail("async, generator, and generic callbacks are not supported.");
          if (fn.node.params.length !== 1 || !t.isIdentifier(fn.node.params[0]) || fn.node.params[0].optional) {
            fail("the callback must have exactly one simple element parameter; index and array parameters are not supported.");
          }
          const element = fn.node.params[0] as Types.Identifier;
          if (element.typeAnnotation || fn.node.returnType) fail("explicit callback type annotations are not supported.");
          if (fn.scope.getBinding(element.name)?.constantViolations.length) fail("reassigning the element parameter is not supported.");
          fn.traverse({
            CallExpression(path) {
              if (t.isIdentifier(path.node.callee, { name: "eval" })) fail("direct eval is not supported.");
            },
          });
          if (fn.isFunctionExpression() && fn.node.id && fn.scope.getBinding(fn.node.id.name)?.referenced) {
            fail("self-referencing callbacks are not supported.");
          }
          if (fn.isFunctionExpression()) {
            fn.traverse({
              Function(inner) { if (!inner.isArrowFunctionExpression()) inner.skip(); },
              ThisExpression() { fail("ordinary callbacks must not access this."); },
              ReferencedIdentifier(path) { if (path.node.name === "arguments") fail("ordinary callbacks must not access arguments."); },
              MetaProperty(path) { if (path.node.meta.name === "new") fail("ordinary callbacks must not access new.target."); },
            });
          }
          const body = fn.node.body;
          let expression: Types.Expression;
          if (t.isBlockStatement(body)) {
            if (body.directives.length || body.body.length !== 1 || !t.isReturnStatement(body.body[0])
              || !body.body[0].argument) fail("callback bodies must be an expression or a single return statement.");
            expression = (body.body[0] as Types.ReturnStatement).argument!;
          } else expression = body;
          // Capture the receiver before introducing the callback parameter's scope.
          const input = statement.scope.generateUidIdentifier("items");
          const result = statement.scope.generateUidIdentifier("result");
          const parameter = t.identifier((fn.node.params[0] as Types.Identifier).name);
          const output: Types.Statement[] = [
            t.variableDeclaration("const", [t.variableDeclarator(input, member.object as Types.Expression)]),
          ];
          if (method === "map" || !statement.isReturnStatement()) {
            output.push(t.variableDeclaration(method === "map" ? "const" : "let", [
              t.variableDeclarator(result, method === "map" ? t.arrayExpression() : t.booleanLiteral(false)),
            ]));
          }
          const action = method === "map"
            ? t.expressionStatement(t.assignmentExpression("=", t.memberExpression(result,
              t.memberExpression(result, t.identifier("length")), true), expression))
            : t.ifStatement(expression, t.blockStatement(statement.isReturnStatement()
              ? [t.returnStatement(t.booleanLiteral(true))]
              : [t.expressionStatement(t.assignmentExpression("=", result, t.booleanLiteral(true))), t.breakStatement()]));
          const loopBody = t.isBlockStatement(body) ? body : t.blockStatement([]);
          if (t.isBlockStatement(body)) {
            const original = body.body[0]!;
            t.inheritsComments(action, original);
            // Later directive placement uses statement positions.
            if (original.start != null) action.start = original.start;
            if (original.end != null) action.end = original.end;
            if (original.loc) action.loc = original.loc;
          }
          loopBody.body = [action];
          output.push(t.forOfStatement(t.variableDeclaration("const", [t.variableDeclarator(parameter)]), input, loopBody));
          if (statement.isReturnStatement()) output.push(t.returnStatement(method === "map" ? result : t.booleanLiteral(false)));
          else if (statement.isVariableDeclaration()) {
            statement.node.declarations[0]!.init = result;
            output.push(statement.node);
          }
          // Remove the consumed marker from both Babel's and Recast's attachments.
          t.traverseFast(program.node, (node: any) => {
            for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
              if (node[key]) node[key] = node[key].filter((c: Types.Comment) => c.start !== comment.start || c.end !== comment.end);
            }
          });
          t.inheritsComments(output[0]!, statement.node);
          statement.replaceWithMultiple(output);
        }
        program.scope.crawl();
      },
    },
  };
}
