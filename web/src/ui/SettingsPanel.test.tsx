import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { DEFAULT_VISUAL } from "../store/visualSettings";
import { useStore } from "../store/useStore";
import { SettingsPanel } from "./SettingsPanel";

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ visual: { ...DEFAULT_VISUAL } });
});

test("sliders change the look and are saved in localStorage", () => {
  render(<SettingsPanel />);
  fireEvent.change(screen.getByLabelText("Star size"), { target: { value: "1.6" } });
  fireEvent.change(screen.getByLabelText("Star brightness"), { target: { value: "0.5" } });
  fireEvent.change(screen.getByLabelText("Web line brightness"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Spin sensitivity"), { target: { value: "2.5" } });
  expect(useStore.getState().visual).toEqual({ starSize: 1.6, brightness: 0.5, webLine: 2, spin: 2.5 });
  expect(JSON.parse(localStorage.getItem("cosmos.visual")!)).toEqual({ starSize: 1.6, brightness: 0.5, webLine: 2, spin: 2.5 });
  expect(screen.getByText("1.6×")).toBeInTheDocument();
});

test("reset puts every slider back and clears the saved choice", () => {
  useStore.getState().setVisual({ starSize: 2, spin: 0.3 });
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Reset look" }));
  expect(useStore.getState().visual).toEqual(DEFAULT_VISUAL);
  expect(localStorage.getItem("cosmos.visual")).toBeNull();
});

test("the existing quality and motion settings are still there", () => {
  render(<SettingsPanel />);
  expect(screen.getByLabelText("Quality")).toBeInTheDocument();
  expect(screen.getByLabelText("Reduce motion")).toBeInTheDocument();
});
