import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { Combobox, type ComboOption } from "./Combobox";

const OPTS: ComboOption[] = [
  { value: "public.users.email", label: "email", hint: "text", group: "users" },
  { value: "public.users.name", label: "name", hint: "text", group: "users" },
  { value: "public.orders.status", label: "status", hint: "int4", group: "orders" },
  { value: "public.orders.total", label: "total", hint: "numeric", group: "orders" },
];

function Harness(props: Partial<React.ComponentProps<typeof Combobox>> & { onPick?: (v: string) => void }) {
  const [v, setV] = useState("");
  return <Combobox ariaLabel="Column" value={v} options={OPTS} onPick={(x) => { setV(x); props.onPick?.(x); }} {...props} />;
}
const input = () => screen.getByRole("combobox", { name: "Column" });

test("typing narrows the list by label, table or type, and clicking picks", () => {
  const onPick = vi.fn();
  render(<Harness onPick={onPick} />);
  fireEvent.focus(input());
  expect(screen.getAllByRole("option")).toHaveLength(4);
  fireEvent.change(input(), { target: { value: "ORD tot" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("total")]);
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(onPick).toHaveBeenCalledWith("public.orders.total");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("arrow keys move, Enter picks, Escape closes", () => {
  const onPick = vi.fn();
  render(<Harness onPick={onPick} />);
  fireEvent.focus(input());
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith("public.users.name");
  fireEvent.focus(input());
  fireEvent.keyDown(input(), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("no match says so, and free text can be committed when allowed", () => {
  const onPick = vi.fn();
  render(<Harness allowFree onPick={onPick} />);
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: "zzz" } });
  expect(screen.getByText("No matches")).toBeInTheDocument();
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith("zzz");
});

test("only the first rows are drawn for a huge list", () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ value: `c${i}`, label: `c${i}` }));
  render(<Combobox ariaLabel="Column" value="" options={many} onPick={() => {}} maxShown={50} />);
  fireEvent.focus(input());
  expect(screen.getAllByRole("option")).toHaveLength(50);
  expect(screen.getByText(/Showing 50 of 5000/)).toBeInTheDocument();
});

test("onType reports the text so a server can answer (and the list is not filtered again)", async () => {
  const seen: string[] = [];
  render(<Combobox ariaLabel="Column" value="" options={[{ value: "abc", label: "abc" }]} filter={false} onType={(t) => seen.push(t)} onPick={() => {}} />);
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: "xyz" } });
  expect(seen).toEqual(["xyz"]);
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await act(async () => {});
});
