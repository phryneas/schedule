import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API, SignatureKind } from "typescript/unstable/sync";
import { isVariableStatement } from "typescript/unstable/ast";

test("MapResults keeps single signatures and pads overload sets to ten", () => {
  const path = fileURLToPath(new URL("./overloadMapping.types.ts", import.meta.url));
  const config = fileURLToPath(new URL("../tsconfig.test-types.json", import.meta.url));
  const api = new API();
  try {
    const project = api.updateSnapshot({ openProjects: [config] }).getProject(config)!;
    const { checker } = project;
    const source = project.program.getSourceFile(path)!;
    const expected = new Map([
      ["mappedAdd", 1],
      ["promised", 10],
      ["scheduledByArity", 10],
      ["mappedFour", 10],
      ["mapped", 10],
      ["mappedTen", 10],
    ]);
    for (const statement of source.statements) {
      if (!isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText();
        if (!expected.has(name)) continue;
        const type = checker.getTypeAtLocation(declaration.name)!;
        assert.equal(checker.getSignaturesOfType(type, SignatureKind.Call).length, expected.get(name), name);
        expected.delete(name);
      }
    }
    assert.equal(expected.size, 0, "All signature-count fixtures were checked");
  } finally {
    api.close();
  }
});
