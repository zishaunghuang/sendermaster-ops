import { test } from "node:test";
import assert from "node:assert/strict";
import contract from "../contracts/openapi.json";
import type { components } from "../lib/api-types";
const command: components["schemas"]["Command"] = {
  operationId: "1234567890123456",
  organizationId: "org",
  action: "pause",
  reason: "operator investigation",
  version: 1,
};
test("UI commands stay within the versioned core contract", () => {
  assert(
    contract.components.schemas.Command.properties.action.enum.includes(
      command.action,
    ),
  );
  assert(contract.paths["/v2/internal/ops/commands"].post.security.length);
  assert.equal(contract.info.version, "1.0.0");
});
