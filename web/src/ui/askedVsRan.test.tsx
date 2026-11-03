import { fireEvent, render, screen, within } from "@testing-library/react";
import { useStore } from "../store/useStore";
import { expect, test } from "vitest";
import { AskedVsRan } from "./AskedVsRan";
import type { Candidate, Flag, SearchRequest } from "../types";

const req: SearchRequest = { select: ["public.users.email", "public.sppProject.name"], where: { col: "public.sppProject.id", cmp: "=", value: "abc" }, fk_choices: {} };
const flag: Flag = { code: "UNREACHABLE", table: "public.sppProject", column: null, message: "no path" };
const cand = { id: "c1", shape: "Join", fk_ids: [], tables: [], joins: 0, query_count: 1, queries: [{ sql: 'SELECT "t0"."email" FROM "public"."users" AS "t0"', params: [] }] } as Candidate;

test("the asked query keeps the dropped parts (struck through) next to the query that ran", () => {
  render(<AskedVsRan req={req} flags={[flag]} top={cand} />);
  const before = screen.getByLabelText("Request as asked");
  expect(before).toHaveTextContent('SELECT "users"."email", "sppProject"."name"');
  expect(before).toHaveTextContent('FROM "public"."users", "public"."sppProject"');
  expect(before).toHaveTextContent("cross-joined");
  expect(before).toHaveTextContent(`WHERE "sppProject"."id" = 'abc'`);
  const struck = within(before).getAllByText((_, el) => el?.tagName === "DEL");
  expect(struck.map((e) => e.textContent)).toEqual(['"sppProject"."name"', '"public"."sppProject"', `"sppProject"."id" = 'abc'`]);
  expect(screen.getByLabelText("Query that ran")).toHaveTextContent('SELECT "t0"."email" FROM "public"."users"');
});

test("nothing is shown when nothing was dropped", () => {
  const { container } = render(<AskedVsRan req={req} flags={[{ ...flag, code: "AMBIGUOUS_FK" }]} top={cand} />);
  expect(container).toBeEmptyDOMElement();
});

test("with no runnable plan it says so", () => {
  render(<AskedVsRan req={req} flags={[flag]} top={null} />);
  expect(screen.getByText(/Nothing runnable was left/)).toBeInTheDocument();
});

test("an unlinked table offers a button that opens Search with an empty join row", () => {
  useStore.setState({ searchJoins: [], drawer: null });
  render(<AskedVsRan req={req} flags={[flag]} top={cand} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a join" }));
  expect(useStore.getState().drawer).toBe("search");
  expect(useStore.getState().searchJoins).toEqual([{ from: "", to: "" }]);
});
