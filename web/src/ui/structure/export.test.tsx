import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useStore } from "../../store/useStore";
import { ExportSection } from "./ExportSection";

const saved: { name: string; text: string }[] = [];
vi.mock("../download", () => ({ downloadText: (name: string, text: string) => saved.push({ name, text }) }));

beforeEach(() => {
  saved.length = 0;
  useStore.setState({ changeLog: [], experiments: [], structureError: null });
});

test("changes script is disabled until something was changed, then downloads the statements", () => {
  const { rerender } = render(<ExportSection api={{ exportStructure: async () => "" }} />);
  expect(screen.getByRole("button", { name: "Changes script (.sql)" })).toBeDisabled();
  useStore.setState({ changeLog: [{ label: "Add index", sql: ["CREATE INDEX i ON t (c)"] }] });
  rerender(<ExportSection api={{ exportStructure: async () => "" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Changes script (.sql)" }));
  expect(saved[0].name).toBe("cosmic-webs-changes.sql");
  expect(saved[0].text).toContain("CREATE INDEX i ON t (c);");
});

test("structure and structure+data come from the server and are saved under the server's file names", async () => {
  const asked: string[] = [];
  const api = { exportStructure: async (kind: "schema" | "full") => (asked.push(kind), `-- dump ${kind}`) };
  render(<ExportSection api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Current structure (.sql)" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Structure + data (.sql)" }));
  await waitFor(() => expect(saved).toHaveLength(2));
  expect(asked).toEqual(["schema", "full"]);
  expect(saved.map((s) => s.name)).toEqual(["cosmic-webs-structure.sql", "cosmic-webs-structure-and-data.sql"]);
});

test("a failed export shows the server's message and saves nothing", async () => {
  render(<ExportSection api={{ exportStructure: async () => { throw new Error("pg_dump is not installed on the server, so the export is not available."); } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Current structure (.sql)" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("pg_dump is not installed");
  expect(saved).toHaveLength(0);
});

test("the experiments table exports as CSV", () => {
  useStore.setState({ experiments: [{ id: 0, label: "Baseline", plans: 1, flags: 0, best: null }] });
  render(<ExportSection api={{ exportStructure: async () => "" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Before / after table (.csv)" }));
  expect(saved[0].name).toBe("cosmic-webs-experiments.csv");
  expect(saved[0].text.startsWith("change,best_plan")).toBe(true);
});
