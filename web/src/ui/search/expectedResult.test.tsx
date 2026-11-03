import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useStore } from "../../store/useStore";
import { emptyShape } from "./shape";
import { ExpectedResult } from "./ExpectedResult";
import type { SchemaGraph } from "../../types";

const run = vi.fn(async () => [] as string[]);
vi.mock("../../search/executeSearch", () => ({ executeSearch: () => run() }));

const col = (name: string, type = "int4") => ({ name, type, nullable: false, pk: false });
const graph: SchemaGraph = { tables: [{ name: "public.users", row_estimate: 1, columns: [col("id"), col("name", "text")] }, { name: "public.orders", row_estimate: 1, columns: [col("user_id"), col("total", "numeric")] }], fks: [] };
const answer = { explanation: "Total paid per user.", request: { select: ["public.users.name"], aggregates: [{ func: "SUM", col: "public.orders.total" }], limit: 20, where: { col: "public.users.nope", cmp: "=", value: 1 } }, joins: [{ from: "public.orders.user_id", to: "public.users.id" }], sql: [{ title: "left join", sql: "SELECT 1" }] };
const reply = (content: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] } : content), { status }));

beforeEach(() => {
  run.mockClear();
  localStorage.clear();
  useStore.setState({ graph, ai: { apiKey: "sk-or-x", model: "openai/test" }, aiSql: [], searchSelect: [], searchDraft: null, searchShape: emptyShape(), searchJoins: [], drawer: "search" });
});

const type = (t: string) => fireEvent.change(screen.getByLabelText("Describe the result you expect"), { target: { value: t } });

test("without a key the button is off and a shortcut to Settings is offered", () => {
  useStore.setState({ ai: { apiKey: "", model: "" } });
  render(<ExpectedResult />);
  type("something");
  expect(screen.getByRole("button", { name: "Ask AI" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Add API key in Settings" }));
  expect(useStore.getState().drawer).toBe("settings");
});

test("asking fills the builder, lists warnings and AI SQL, and runs the search", async () => {
  const f = reply(answer);
  render(<ExpectedResult fetchImpl={f as any} />);
  type("total paid per user");
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(await screen.findByLabelText("AI answer")).toHaveTextContent("Total paid per user.");
  const s = useStore.getState();
  expect(s.searchSelect).toEqual(["public.users.name"]);
  expect(s.searchShape.limit).toBe("20");
  expect(s.searchJoins).toHaveLength(1);
  expect(s.aiSql.map((q) => q.title)).toEqual(["left join"]);
  expect(screen.getByText(/public.users.nope does not exist/)).toBeInTheDocument();
  expect(screen.getByText("AI SQL (1)")).toBeInTheDocument();
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(String((f.mock.calls[0] as any)[0])).toContain("openrouter.ai");
});

test("with 'run right after' off it only fills the builder", async () => {
  render(<ExpectedResult fetchImpl={reply(answer) as any} />);
  type("x");
  fireEvent.click(screen.getByLabelText("Run the search right after"));
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  await screen.findByLabelText("AI answer");
  expect(run).not.toHaveBeenCalled();
});

test("an OpenRouter error is shown and nothing in the builder changes", async () => {
  useStore.setState({ searchSelect: ["public.users.id"] });
  render(<ExpectedResult fetchImpl={reply({ error: { message: "No auth" } }, 401) as any} />);
  type("x");
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("did not accept the API key");
  expect(useStore.getState().searchSelect).toEqual(["public.users.id"]);
});

test("an answer that is not JSON says so", async () => {
  render(<ExpectedResult fetchImpl={reply("Sorry, I can't.") as any} />);
  type("x");
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not valid JSON");
});

test("the AI SQL can be cleared", async () => {
  useStore.setState({ aiSql: [{ title: "t", sql: "SELECT 1", params: [] }] });
  render(<ExpectedResult />);
  fireEvent.click(screen.getByRole("button", { name: "Clear AI SQL" }));
  expect(useStore.getState().aiSql).toEqual([]);
});
