import { Request, Response, NextFunction } from 'express';
import { AppModule, hasPermission, PermissionAction } from '../domain/permissions.js';

export function requirePermission(module: AppModule, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!hasPermission(req.user, module, action)) {
      res.status(403).json({
        error: `Acesso negado: você não possui permissão para "${action}" no módulo "${module}".`,
      });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  if (req.user.role !== 'ADMINISTRADOR') {
    res.status(403).json({
      error: 'Acesso restrito: esta operação exige perfil ADMINISTRADOR.',
    });
    return;
  }
  next();
}
