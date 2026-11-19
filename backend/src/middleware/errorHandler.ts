import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../domain/periodLock.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => e.message).join(' ');
    res.status(400).json({
      error: messages || 'Dados inválidos enviados na requisição.',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    });
    return;
  }

  const pgErr = err as { code?: string; detail?: string; message?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({
      error: 'Registro duplicado detectado. Esta informação já existe no banco de dados.',
      code: 'DUPLICATE_RECORD',
    });
    return;
  }
  if (pgErr?.code === '23514' || pgErr?.code === '22P02') {
    res.status(400).json({
      error: 'Valor inválido ou violação de regra de integridade dos dados.',
      code: 'INTEGRITY_ERROR',
    });
    return;
  }

  console.error('[FINANCER ERROR]', err);
  const message =
    err instanceof Error && err.message
      ? err.message
      : 'Erro interno do servidor ao processar a solicitação.';
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}
