import { planSemesterCreation, isSemesterReadOnly } from "@/domain/semester-lifecycle";

describe("planSemesterCreation", () => {
  it("returns an empty close list when there is no existing active semester", () => {
    const plan = planSemesterCreation([{ id: "s-1", status: "closed" }]);
    expect(plan.semesterIdsToClose).toEqual([]);
  });

  it("returns an empty close list when there are no existing semesters at all", () => {
    expect(planSemesterCreation([]).semesterIdsToClose).toEqual([]);
  });

  it("returns the currently active semester's id so it gets auto-closed (03-business-rules.md §10)", () => {
    const plan = planSemesterCreation([
      { id: "s-1", status: "closed" },
      { id: "s-2", status: "active" },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["s-2"]);
  });

  it("returns every active semester id if more than one is somehow active (defensive)", () => {
    const plan = planSemesterCreation([
      { id: "s-1", status: "active" },
      { id: "s-2", status: "active" },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["s-1", "s-2"]);
  });
});

describe("isSemesterReadOnly", () => {
  it("returns true for a closed semester", () => {
    expect(isSemesterReadOnly("closed")).toBe(true);
  });

  it("returns false for an active semester", () => {
    expect(isSemesterReadOnly("active")).toBe(false);
  });
});
