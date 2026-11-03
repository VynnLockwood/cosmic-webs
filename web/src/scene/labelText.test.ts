import { labelText } from "./style";

test("labelText drops the public schema and shortens long names", () => {
  expect(labelText("public.users")).toBe("users");
  expect(labelText("audit.users")).toBe("audit.users");
  expect(labelText("public.sppCaseCommercialOperationAppointment")).toBe("sppCaseCommercialOper…");
  expect(labelText("public.sppCaseCommercialOperationAppointment")).toHaveLength(22);
});
