import { describe, expect, it } from 'vitest';
import {
  calculateCashRunningBalances,
  calculateExpenseFinalAmount,
  calculateExpenseTotals,
  calculateReconciliationResult,
  calculateTripTotals,
  calculateTripValues,
  computeReminderAlertSituation,
  generateMonthlyCompetences,
  validateCashMovement,
} from '../src/domain/calculations.js';
import { getDefaultPermissionsForRole, hasPermission } from '../src/domain/permissions.js';
import { formatBRL, formatDateBR } from '../src/domain/formatters.js';

describe('FINANCER - Regras de Cálculo Financeiro e Validações', () => {
  it('calcula valor final de despesas com desconto e juros corretamente', () => {
    expect(calculateExpenseFinalAmount(1000, 50, 25.5)).toBe(975.5);
    expect(calculateExpenseFinalAmount(250.75, 0, 0)).toBe(250.75);
    expect(() => calculateExpenseFinalAmount(-10, 0, 0)).toThrow();
    expect(() => calculateExpenseFinalAmount(100, -5, 0)).toThrow();
    expect(() => calculateExpenseFinalAmount(100, 0, -2)).toThrow();
  });

  it('calcula totais e subtotais de despesas por categoria e tipo', () => {
    const totals = calculateExpenseTotals([
      {
        category: 'Alimentação',
        expense_type: 'Empresa',
        original_amount: 500,
        discount: 20,
        interest: 10,
        final_amount: 490,
      },
      {
        category: 'Farmácia',
        expense_type: 'Pessoal',
        original_amount: 200,
        discount: 0,
        interest: 5,
        final_amount: 205,
      },
      {
        category: 'Alimentação',
        expense_type: 'Empresa',
        original_amount: 300,
        discount: 10,
        interest: 0,
        final_amount: 290,
      },
    ]);
    expect(totals.grossTotal).toBe(1000);
    expect(totals.totalDiscount).toBe(30);
    expect(totals.totalInterest).toBe(15);
    expect(totals.netTotal).toBe(985);
    expect(totals.byCategory).toHaveLength(2);
    expect(totals.byType).toHaveLength(2);
  });

  it('calcula Valor Gasto e VPP nas viagens e bloqueia divisão por zero', () => {
    // Exemplo oficial da especificação (Seção 4.2)
    const res = calculateTripValues(1000, 200, 4);
    expect(res.spentAmount).toBe(800);
    expect(res.vpp).toBe(200);

    expect(() => calculateTripValues(1000, 200, 0)).toThrow(/maior que zero/i);
    expect(() => calculateTripValues(1000, 200, -2)).toThrow(/maior que zero/i);

    const summary = calculateTripTotals([
      { departure_amount: 1000, return_amount: 200, spent_amount: 800, people_count: 4, vpp: 200 },
      { departure_amount: 600, return_amount: 100, spent_amount: 500, people_count: 2, vpp: 250 },
    ]);
    expect(summary.totalDisbursed).toBe(1600);
    expect(summary.totalReturned).toBe(300);
    expect(summary.totalSpent).toBe(1300);
    expect(summary.totalPeople).toBe(6);
    expect(summary.averagePerPerson).toBe(216.67);
  });

  it('gera corretamente 12 competências mensais (Jan a Dez 2026) ajustando dias finais de mês', () => {
    const list = generateMonthlyCompetences('2026-01-31', '2026-12-31');
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual({ year: 2026, month: 1, dueDate: '2026-01-31' });
    expect(list[1]).toEqual({ year: 2026, month: 2, dueDate: '2026-02-28' });
    expect(list[3]).toEqual({ year: 2026, month: 4, dueDate: '2026-04-30' });
    expect(list[11]).toEqual({ year: 2026, month: 12, dueDate: '2026-12-31' });
  });

  it('classifica corretamente alertas de vencimento de lembretes', () => {
    expect(computeReminderAlertSituation('PAGA', '2026-01-10', '2026-05-01', 5)).toBe('PAGA');
    expect(computeReminderAlertSituation('PENDENTE', '2026-05-01', '2026-05-05', 5)).toBe('VENCIDA');
    expect(computeReminderAlertSituation('PENDENTE', '2026-05-08', '2026-05-05', 5)).toBe(
      'PROXIMO_VENCIMENTO'
    );
    expect(computeReminderAlertSituation('PENDENTE', '2026-05-20', '2026-05-05', 5)).toBe(
      'PENDENTE'
    );
  });

  it('valida movimentações do caixa e calcula saldo acumulado corretamente', () => {
    expect(() => validateCashMovement(500, 100)).toThrow(/simultaneamente/i);
    expect(() => validateCashMovement(0, 0)).toThrow();
    expect(validateCashMovement(10000, 0).entryType).toBe('ENTRADA');
    expect(validateCashMovement(0, 3500).entryType).toBe('SAIDA');

    const calc = calculateCashRunningBalances(0, [
      { inflow: 10000, outflow: 0 },
      { inflow: 0, outflow: 3500 },
    ]);
    expect(calc.totalInflows).toBe(10000);
    expect(calc.totalOutflows).toBe(3500);
    expect(calc.closingBalance).toBe(6500);
    expect(calc.items[0].running_balance).toBe(10000);
    expect(calc.items[1].running_balance).toBe(6500);
  });

  it('calcula conciliação financeira e status corretamente', () => {
    expect(calculateReconciliationResult(6500, 6500)).toEqual({
      difference: 0,
      status: 'CONCILIADO',
    });
    expect(calculateReconciliationResult(6500, 6450)).toEqual({
      difference: -50,
      status: 'DIVERGENTE',
    });
    expect(calculateReconciliationResult(6500, null)).toEqual({
      difference: null,
      status: 'PENDENTE',
    });
  });

  it('aplica permissões granulares e formatação brasileira corretamente', () => {
    const consulta = { role: 'CONSULTA' as const, permissions: getDefaultPermissionsForRole('CONSULTA') };
    expect(hasPermission(consulta, 'expenses', 'view')).toBe(true);
    expect(hasPermission(consulta, 'expenses', 'create')).toBe(false);
    expect(hasPermission(consulta, 'closing', 'reopen_period')).toBe(false);

    const admin = {
      role: 'ADMINISTRADOR' as const,
      permissions: getDefaultPermissionsForRole('ADMINISTRADOR'),
    };
    expect(hasPermission(admin, 'closing', 'reopen_period')).toBe(true);
    expect(hasPermission(admin, 'audit', 'delete')).toBe(false);

    expect(formatBRL(1250)).toBe('R$ 1.250,00');
    expect(formatBRL(-45.5)).toBe('-R$ 45,50');
    expect(formatDateBR('2026-03-15')).toBe('15/03/2026');
  });
});
