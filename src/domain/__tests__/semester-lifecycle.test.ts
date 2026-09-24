import {
  planSemesterCreation,
  isSemesterReadOnly,
  planActiveSemesterReconciliation,
} from "@/domain/semester-lifecycle";

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

describe("planActiveSemesterReconciliation", () => {
  // Real-world scenario: two devices sharing one sync account, each having
  // independently done its own onboarding (creating its own "active"
  // semester) BEFORE ever linking to the account — pulling the other
  // device's semester then leaves two rows simultaneously "active" locally,
  // violating 03-business-rules.md §10's single-active-semester invariant.
  // Both devices must independently reach the exact same "which one wins"
  // decision from the same (already-synced, identical) input, or they'd
  // keep flip-flopping the closed one back and forth forever via sync.
  //
  // Content (subjectCount) is the PRIMARY signal, not recency: a fresh
  // device's own onboarding always creates a brand-new, empty semester,
  // which is trivially "more recent" than a semester someone has been
  // actually using for weeks — recency alone would silently bury the real
  // semester behind an empty stub every single time. Recency is only the
  // tie-break between two semesters that both genuinely have content (or
  // both don't).

  it("does nothing when zero or one semester is active", () => {
    expect(planActiveSemesterReconciliation([]).semesterIdsToClose).toEqual([]);
    expect(
      planActiveSemesterReconciliation([
        {
          id: "s-1",
          status: "active",
          updatedAt: null,
          createdAt: new Date(1000),
          subjectCount: 0,
        },
      ]).semesterIdsToClose,
    ).toEqual([]);
  });

  it("keeps the semester with real content active, even if it is the OLDER one", () => {
    // This is the exact reported bug: an empty semester created moments
    // ago (during a fresh device's onboarding) must never outrank an
    // established semester with real subjects, no matter how "recent" the
    // empty one looks by timestamp alone.
    const plan = planActiveSemesterReconciliation([
      {
        id: "real",
        status: "active",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
        subjectCount: 3,
      },
      {
        id: "empty-onboarding-stub",
        status: "active",
        updatedAt: new Date(9_999_999),
        createdAt: new Date(9_999_999),
        subjectCount: 0,
      },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["empty-onboarding-stub"]);
  });

  it("falls back to recency when both semesters have real content", () => {
    const plan = planActiveSemesterReconciliation([
      {
        id: "older",
        status: "active",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
        subjectCount: 2,
      },
      {
        id: "newer",
        status: "active",
        updatedAt: new Date(2000),
        createdAt: new Date(2000),
        subjectCount: 5,
      },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["older"]);
  });

  it("falls back to recency when both semesters are equally empty", () => {
    const plan = planActiveSemesterReconciliation([
      {
        id: "older",
        status: "active",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
        subjectCount: 0,
      },
      {
        id: "newer",
        status: "active",
        updatedAt: new Date(2000),
        createdAt: new Date(2000),
        subjectCount: 0,
      },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["older"]);
  });

  it("falls back to createdAt when updatedAt is null (never edited since creation)", () => {
    const plan = planActiveSemesterReconciliation([
      {
        id: "older",
        status: "active",
        updatedAt: null,
        createdAt: new Date(1000),
        subjectCount: 1,
      },
      {
        id: "newer",
        status: "active",
        updatedAt: null,
        createdAt: new Date(2000),
        subjectCount: 1,
      },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["older"]);
  });

  it("closes every loser when more than two semesters are somehow active at once", () => {
    const plan = planActiveSemesterReconciliation([
      {
        id: "a",
        status: "active",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
        subjectCount: 1,
      },
      {
        id: "b",
        status: "active",
        updatedAt: new Date(3000),
        createdAt: new Date(3000),
        subjectCount: 1,
      },
      {
        id: "c",
        status: "active",
        updatedAt: new Date(2000),
        createdAt: new Date(2000),
        subjectCount: 1,
      },
    ]);
    expect(plan.semesterIdsToClose.sort()).toEqual(["a", "c"]);
  });

  it("ignores already-closed semesters entirely", () => {
    const plan = planActiveSemesterReconciliation([
      {
        id: "s-1",
        status: "closed",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
        subjectCount: 1,
      },
      {
        id: "s-2",
        status: "active",
        updatedAt: new Date(2000),
        createdAt: new Date(2000),
        subjectCount: 1,
      },
    ]);
    expect(plan.semesterIdsToClose).toEqual([]);
  });

  it("breaks an exact tie (same content bucket, same timestamp) deterministically by id", () => {
    const sameTime = new Date(1000);
    const planForward = planActiveSemesterReconciliation([
      { id: "aaa", status: "active", updatedAt: sameTime, createdAt: sameTime, subjectCount: 1 },
      { id: "zzz", status: "active", updatedAt: sameTime, createdAt: sameTime, subjectCount: 1 },
    ]);
    const planReversed = planActiveSemesterReconciliation([
      { id: "zzz", status: "active", updatedAt: sameTime, createdAt: sameTime, subjectCount: 1 },
      { id: "aaa", status: "active", updatedAt: sameTime, createdAt: sameTime, subjectCount: 1 },
    ]);
    // Input order must not affect the outcome — both devices may see this
    // same set in a different local order, but must close the same loser.
    expect(planForward.semesterIdsToClose).toEqual(planReversed.semesterIdsToClose);
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
