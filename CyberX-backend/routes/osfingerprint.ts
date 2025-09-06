import { Router } from "express";
import { osFingerprint } from "../scanners/osFingerprint";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { target } = req.body;
    if (!target) return res.status(400).json({ error: "Target is required" });

    const result = await osFingerprint(target);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
