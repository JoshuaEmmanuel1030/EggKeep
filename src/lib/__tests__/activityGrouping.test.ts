import { describe, it, expect } from "vitest";
import {
  orderBucketKey,
  sameOrder,
  canEditEntry,
  editWindowHoursRemaining,
  clampReturnQty,
} from "../activityGrouping";

const base = {
  buyerName: "OSAVE BKS",
  orderLines: [{ skuCode: "OSV-18", packQty: 4 }],
  outflowDate: "2026-09-03",
};

describe("buyer-order 30s-bucket grouping", () => {
  it("collapses rows from the same order within the same 30s bucket", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:10.000Z" };
    const b = { ...base, recordedAt: "2026-09-03T09:15:29.000Z" };
    expect(sameOrder(a, b)).toBe(true);
  });

  it("separates rows that cross a 30s bucket boundary", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:29.000Z" };
    const b = { ...base, recordedAt: "2026-09-03T09:15:31.000Z" };
    expect(sameOrder(a, b)).toBe(false);
  });

  it("separates different buyers in the same bucket", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:10.000Z" };
    const b = { ...base, buyerName: "SEGARI TGR", recordedAt: "2026-09-03T09:15:10.000Z" };
    expect(sameOrder(a, b)).toBe(false);
  });

  it("separates same buyer but different order content", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:10.000Z" };
    const b = {
      ...base,
      orderLines: [{ skuCode: "OSV-18", packQty: 5 }],
      recordedAt: "2026-09-03T09:15:10.000Z",
    };
    expect(sameOrder(a, b)).toBe(false);
  });

  it("separates same content on different outflow (business) dates", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:10.000Z" };
    const b = { ...base, outflowDate: "2026-09-04", recordedAt: "2026-09-03T09:15:10.000Z" };
    expect(sameOrder(a, b)).toBe(false);
  });

  it("produces a stable string key", () => {
    const a = { ...base, recordedAt: "2026-09-03T09:15:10.000Z" };
    expect(orderBucketKey(a)).toBe(orderBucketKey({ ...a }));
  });
});

describe("edit-window gating", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("admins can always edit, regardless of age or owner", () => {
    expect(
      canEditEntry({
        createdAt: "2020-01-01T00:00:00.000Z",
        entryUserId: "someone-else",
        currentUserId: "me",
        isAdmin: true,
        now,
      })
    ).toBe(true);
  });

  it("owner can edit within 48h", () => {
    expect(
      canEditEntry({
        createdAt: "2026-09-02T12:00:00.000Z", // 24h ago
        entryUserId: "me",
        currentUserId: "me",
        isAdmin: false,
        now,
      })
    ).toBe(true);
  });

  it("owner cannot edit after 48h", () => {
    expect(
      canEditEntry({
        createdAt: "2026-08-30T12:00:00.000Z", // ~96h ago
        entryUserId: "me",
        currentUserId: "me",
        isAdmin: false,
        now,
      })
    ).toBe(false);
  });

  it("non-owner non-admin cannot edit someone else's entry", () => {
    expect(
      canEditEntry({
        createdAt: "2026-09-03T11:00:00.000Z", // fresh
        entryUserId: "someone-else",
        currentUserId: "me",
        isAdmin: false,
        now,
      })
    ).toBe(false);
  });

  it("reports remaining hours, floored at 0", () => {
    expect(editWindowHoursRemaining("2026-09-02T12:00:00.000Z", now)).toBe(24);
    expect(editWindowHoursRemaining("2026-08-01T12:00:00.000Z", now)).toBe(0);
  });
});

describe("return quantity clamp", () => {
  it("caps at the line max", () => {
    expect(clampReturnQty("200", 155)).toBe(155);
  });

  it("passes through values under the max", () => {
    expect(clampReturnQty("30", 155)).toBe(30);
  });

  it("accepts comma decimals (id locale)", () => {
    expect(clampReturnQty("12,5", 155)).toBe(12.5);
  });

  it("treats non-numeric / negative / zero as 0", () => {
    expect(clampReturnQty("abc", 155)).toBe(0);
    expect(clampReturnQty("-5", 155)).toBe(0);
    expect(clampReturnQty("0", 155)).toBe(0);
  });

  it("handles exact-max as valid", () => {
    expect(clampReturnQty(155, 155)).toBe(155);
  });
});
