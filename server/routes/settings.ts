import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { defaultAppSettings } from "../db";
import { validate } from "./validation";

const ScanPathsSchema = z.object({
  homeDir: z.string().nullable().optional(),
  claudeDir: z.string().nullable().optional(),
  extraMcpFiles: z.array(z.string()).max(50).optional(),
  extraProjectDirs: z.array(z.string()).max(50).optional(),
  extraSkillDirs: z.array(z.string()).max(50).optional(),
  extraPluginDirs: z.array(z.string()).max(50).optional(),
}).optional();

const SettingsPatchSchema = z.object({
  appName: z.string().trim().min(1, "appName must be a non-empty string").max(50, "appName must be 50 characters or fewer").optional(),
  scanPaths: ScanPathsSchema,
  onboarded: z.boolean().optional(),
  monthlyBudget: z.number().min(0).max(100000).nullable().optional(),
  selectedPlanId: z.enum(["free", "pro", "max5x", "max20x", "api"]).nullable().optional(),
});

const router = Router();

router.get("/api/settings", (_req, res) => {
  res.json(storage.getAppSettings());
});

router.patch("/api/settings", (req, res) => {
  const parsed = validate(SettingsPatchSchema, req.body, res);
  if (!parsed) return;

  const patch: Partial<import("@shared/types").AppSettings> = {};
  if (parsed.appName !== undefined) patch.appName = parsed.appName;
  if (parsed.scanPaths !== undefined) {
    const current = storage.getAppSettings().scanPaths;
    patch.scanPaths = { ...current, ...parsed.scanPaths };
  }
  if (parsed.onboarded !== undefined) patch.onboarded = parsed.onboarded;
  if (parsed.monthlyBudget !== undefined) patch.monthlyBudget = parsed.monthlyBudget;
  if (parsed.selectedPlanId !== undefined) {
    patch.selectedPlanId = parsed.selectedPlanId;
    patch.planSelectedAt = parsed.selectedPlanId ? new Date().toISOString() : null;
  }

  const updated = storage.updateAppSettings(patch);
  res.json(updated);
});

router.post("/api/settings/reset", (_req, res) => {
  const updated = storage.updateAppSettings({
    appName: defaultAppSettings.appName,
    scanPaths: { ...defaultAppSettings.scanPaths },
  });
  res.json(updated);
});

export default router;
