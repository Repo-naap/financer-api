import { Request, Response, NextFunction } from 'express';
import { AuthenticatedUser, validateSessionToken } from '../services/authService.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      clientIp?: string;
    }
  }
}

export function extractClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    req.clientIp = extractClientIp(req);
    const header = req.headers.authorization || '';
    let token = '';
    if (header.startsWith('Bearer ')) {
      token = header.slice(7).trim();
    } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
      token = req.query.token.trim();
    }

    if (!token) {
      res.status(401).json({ error: 'Sessão não autenticada. Faça login para continuar.' });
      return;
    }

    const user = await validateSessionToken(token);
    if (!user) {
      res.status(401).json({ error: 'Sessão inválida, expirada ou encerrada. Faça login novamente.' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
