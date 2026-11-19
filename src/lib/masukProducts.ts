import type { ItemType } from "@/types/inventory";

// Egg products offered in Masuk: every egg except the (RETAKAN) children.
// Retakan stock only ever arrives through a return (record_return), never as a
// receipt, so Masuk hides it. The shared eggProductNames list keeps it on
// purpose: order lines, OutflowForm and the Kas Tunai dropdown still sell
// retakan eggs.
export function masukEggProducts(
  eggProductNames: string[],
  itemTypes: Pick<ItemType, "name" | "isRetakan">[],
): string[] {
  const retakan = new Set(itemTypes.filter((it) => it.isRetakan).map((it) => it.name));
  return eggProductNames.filter((name) => !retakan.has(name));
}
