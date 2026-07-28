import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Forward a rejected async handler to the error middleware.
 *
 * Express 4 only catches synchronous throws: an async handler that rejects
 * leaves the request hanging until the client times out, and the unhandled
 * rejection takes the whole process down on current Node. Every async route
 * has to go through here.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Prisma's "record required but not found" — the client asked for a bad id. */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2025'
  );
}

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }
      next(error);
    }
  };
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  // Headers already sent — only Express can salvage this, by aborting.
  if (res.headersSent) {
    next(err);
    return;
  }

  // Updating or deleting a project that isn't there is a client mistake, not a
  // server fault; without this it would surface as a 500.
  if (isNotFoundError(err)) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
