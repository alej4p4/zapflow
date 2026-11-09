import { startScheduler } from "@/modules/whatsapp/scheduler";

/**
 * Delegated to unified scheduler in @/modules/whatsapp/scheduler.
 * Retained for backwards-compatibility.
 */
export function initScheduler() {
    startScheduler();
}
