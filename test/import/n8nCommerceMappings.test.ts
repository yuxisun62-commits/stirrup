import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

function importOne(nodeType: string, parameters: Record<string, unknown>) {
  return importN8nWorkflow({
    name: "single",
    nodes: [{ id: "1", name: "Node", type: nodeType, parameters }],
  });
}

describe("Stripe mapper", () => {
  it("customer.create → stripe-create-customer", () => {
    const { workflow, report } = importOne("n8n-nodes-base.stripe", {
      resource: "customer",
      operation: "create",
      email: "buyer@example.com",
      additionalFields: { name: "Buyer" },
    });
    expect(workflow.nodes[0].type).toBe("stripe-create-customer");
    expect(workflow.nodes[0].config.email).toBe("buyer@example.com");
    expect(report.credentialsNeeded).toContain("stripe");
  });

  it("charge.create → stripe-create-charge", () => {
    const { workflow } = importOne("n8n-nodes-base.stripe", {
      resource: "charge",
      operation: "create",
      amount: 2000,
      currency: "usd",
      customerId: "cus_123",
    });
    expect(workflow.nodes[0].type).toBe("stripe-create-charge");
    expect(workflow.nodes[0].config.amount).toBe(2000);
  });

  it("paymentIntent.create → stripe-create-payment-intent", () => {
    const { workflow } = importOne("n8n-nodes-base.stripe", {
      resource: "paymentIntent",
      operation: "create",
      amount: 5000,
      currency: "usd",
    });
    expect(workflow.nodes[0].type).toBe("stripe-create-payment-intent");
  });
});

describe("MongoDB mapper", () => {
  it.each([
    ["find", "mongo-find"],
    ["findOne", "mongo-find-one"],
    ["insert", "mongo-insert"],
    ["update", "mongo-update"],
    ["delete", "mongo-delete"],
    ["aggregate", "mongo-aggregate"],
  ])("%s → %s", (op, expected) => {
    const { workflow, report } = importOne("n8n-nodes-base.mongoDb", {
      operation: op,
      database: { value: "app" },
      collection: { value: "users" },
      query: { status: "active" },
      fields: { name: "Alice" },
      update: { $set: { name: "B" } },
      pipeline: [{ $match: {} }],
    });
    expect(workflow.nodes[0].type).toBe(expected);
    expect(workflow.nodes[0].config.database).toBe("app");
    expect(workflow.nodes[0].config.collection).toBe("users");
    expect(report.credentialsNeeded).toContain("mongodb");
  });
});

describe("Supabase mapper", () => {
  it.each([
    ["getAll", "supabase-select"],
    ["create", "supabase-insert"],
    ["update", "supabase-update"],
    ["delete", "supabase-delete"],
  ])("%s → %s", (op, expected) => {
    const { workflow, report } = importOne("n8n-nodes-base.supabase", {
      operation: op,
      tableId: { value: "profiles" },
      filters: { id: 42 },
      fieldsUi: { fieldValues: [{ name: "Alice" }] },
    });
    expect(workflow.nodes[0].type).toBe(expected);
    expect(workflow.nodes[0].config.table).toBe("profiles");
    expect(report.credentialsNeeded).toContain("supabase");
  });
});
