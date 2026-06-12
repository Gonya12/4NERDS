import type { Event, Worker } from "../types/models";
import { calculatePaymentSummary } from "./paymentMath";

export function isPaidOrConfirmedEvent(event: Event, workers: Worker[]) {
  if (event.status === "skipped" || event.status === "completed") return false;
  if (event.eventStage === "paid" || event.status === "registered" || event.status === "paid" || event.status === "preparing") return true;
  const payment = calculatePaymentSummary(event, workers);
  return payment.totalCost > 0 && payment.totalPaid >= payment.totalCost;
}
