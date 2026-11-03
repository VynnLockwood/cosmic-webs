import { fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../store/useStore";
import type { Suggestion } from "../../types";

const mocks = vi.hoisted(() => ({ addSuggestions: vi.fn(async () => true) }));
vi.mock("../../store/structureActions", async (orig) => ({ ...(await orig<typeof import("../../store/structureActions")>()), ...mocks }));

import { SuggestedLinks } from "./SuggestedLinks";

const s = (id: string, over: Partial<Suggestion> = {}): Suggestion => ({
  id, from_table: `public.${id}`, from_columns: ["sppProject"], to_table: "public.sppProject", to_columns: ["sppProjectID"], reason: "named like the table",
  checked: null, matched: null, verified: false, ...over,
});

beforeEach(() => {
  mocks.addSuggestions.mockClear();
  useStore.setState({
    graph: { tables: [], fks: [{ id: "f", from: { table: "a", columns: ["x"] }, to: { table: "b", columns: ["id"] } }] },
    suggestionsSource: "dump", structureBusy: false,
    suggestions: [s("addr", { checked: 289, matched: 289, verified: true }), s("odd", { checked: 10, matched: 7 }), s("empty")],
  });
});

test("each suggestion shows its evidence", () => {
  render(<SuggestedLinks canAdd />);
  expect(screen.getByText("✓ 289/289 values match")).toBeInTheDocument();
  expect(screen.getByText("⚠ 7/10 values match")).toBeInTheDocument();
  expect(screen.getByText("name match only")).toBeInTheDocument();
  expect(screen.getByText(/declares 1 foreign key\./)).toBeInTheDocument();
  expect(screen.getByText(/checked against the real rows/)).toBeInTheDocument();
});

test("adds one, all confirmed, or all suggestions", () => {
  render(<SuggestedLinks canAdd />);
  fireEvent.click(screen.getByLabelText("Add link empty"));
  expect(mocks.addSuggestions).toHaveBeenLastCalledWith(["empty"]);
  fireEvent.click(screen.getByRole("button", { name: "Add 1 confirmed" }));
  expect(mocks.addSuggestions).toHaveBeenLastCalledWith(["addr"]);
  fireEvent.click(screen.getByRole("button", { name: "Add all 3" }));
  expect(mocks.addSuggestions).toHaveBeenLastCalledWith(["addr", "odd", "empty"]);
});

test("read-only view (live database) has no add buttons", () => {
  render(<SuggestedLinks canAdd={false} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("✓ 289/289 values match")).toBeInTheDocument();
});

test("generated rows are not presented as evidence", () => {
  useStore.setState({ suggestionsSource: "mock" });
  render(<SuggestedLinks canAdd />);
  expect(screen.getByText(/Rows are generated, so only the names can be used as evidence/)).toBeInTheDocument();
});

test("nothing is shown when there are no suggestions", () => {
  useStore.setState({ suggestions: [] });
  const { container } = render(<SuggestedLinks canAdd />);
  expect(container).toBeEmptyDOMElement();
});
