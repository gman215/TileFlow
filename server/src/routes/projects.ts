import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { validate, asyncHandler } from '../middleware/index.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  SaveLayoutSchema,
} from '../validation.js';

const router = Router();

// ─── List Projects ────────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const projects = await prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { room: true, tileConfig: true },
    });
    res.json(projects);
  })
);

// ─── Get Single Project ───────────────────────────────────────────────────────

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { room: true, tileConfig: true, layouts: true },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(project);
  })
);

// ─── Create Project ──────────────────────────────────────────────────────────

router.post(
  '/',
  validate(CreateProjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, room, tileConfig } = req.body;

    const project = await prisma.project.create({
      data: {
        name,
        room: { create: room },
        tileConfig: { create: tileConfig },
      },
      include: { room: true, tileConfig: true },
    });

    res.status(201).json(project);
  })
);

// ─── Update Project ──────────────────────────────────────────────────────────

router.put(
  '/:id',
  validate(UpdateProjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, room, tileConfig } = req.body;

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(room && {
          room: {
            upsert: {
              create: room,
              update: room,
            },
          },
        }),
        ...(tileConfig && {
          tileConfig: {
            upsert: {
              create: tileConfig,
              update: tileConfig,
            },
          },
        }),
      },
      include: { room: true, tileConfig: true },
    });

    res.json(project);
  })
);

// ─── Delete Project ──────────────────────────────────────────────────────────

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

// ─── Save Layout Snapshot ────────────────────────────────────────────────────

router.post(
  '/:id/layouts',
  validate(SaveLayoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const layout = await prisma.savedLayout.create({
      data: {
        projectId: req.params.id,
        ...req.body,
      },
    });
    res.status(201).json(layout);
  })
);

// ─── Get Project Layouts ─────────────────────────────────────────────────────

router.get(
  '/:id/layouts',
  asyncHandler(async (req: Request, res: Response) => {
    const layouts = await prisma.savedLayout.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(layouts);
  })
);

export default router;
