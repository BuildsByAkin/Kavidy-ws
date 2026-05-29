import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EligibilityService } from './eligibility.service';

describe('EligibilityService', () => {
  const svc = new EligibilityService();

  describe('computeAgeYears', () => {
    it('computes age correctly before birthday', () => {
      const now = new Date('2024-06-01T00:00:00Z');
      expect(svc.computeAgeYears('2000-12-31', now)).toBe(23);
    });

    it('computes age correctly after birthday', () => {
      const now = new Date('2024-06-01T00:00:00Z');
      expect(svc.computeAgeYears('2000-01-01', now)).toBe(24);
    });

    it('throws on invalid date', () => {
      expect(() => svc.computeAgeYears('not-a-date')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertEligible', () => {
    const ok = { dateOfBirth: '1990-01-01', state: 'CA' };

    it('passes for eligible user', () => {
      expect(svc.assertEligible(ok)).toEqual({
        dateOfBirth: '1990-01-01',
        state: 'CA',
        country: 'US',
      });
    });

    it('rejects underage', () => {
      const now = new Date();
      const dob = `${now.getUTCFullYear() - 17}-01-01`;
      expect(() => svc.assertEligible({ ...ok, dateOfBirth: dob })).toThrow(
        BadRequestException,
      );
    });

    it('rejects restricted state', () => {
      expect(() => svc.assertEligible({ ...ok, state: 'WA' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects invalid state', () => {
      expect(() => svc.assertEligible({ ...ok, state: 'ZZ' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects non-US country', () => {
      expect(() => svc.assertEligible({ ...ok, country: 'GB' })).toThrow(
        BadRequestException,
      );
    });

    it('normalizes lowercase state', () => {
      expect(svc.assertEligible({ ...ok, state: 'ca' }).state).toBe('CA');
    });
  });

  describe('assertMoneyActionAllowed', () => {
    it('allows eligible US user', () => {
      expect(() =>
        svc.assertMoneyActionAllowed({ country: 'US', state: 'CA' }),
      ).not.toThrow();
    });

    it.each(['WA', 'ID', 'MI', 'NV'])(
      'blocks restricted state %s with ForbiddenException',
      (state) => {
        expect(() =>
          svc.assertMoneyActionAllowed({ country: 'US', state }),
        ).toThrow(ForbiddenException);
      },
    );

    it('blocks non-US country', () => {
      expect(() =>
        svc.assertMoneyActionAllowed({ country: 'GB', state: 'CA' }),
      ).toThrow(ForbiddenException);
    });

    it('blocks when state is missing', () => {
      expect(() =>
        svc.assertMoneyActionAllowed({ country: 'US', state: null }),
      ).toThrow(ForbiddenException);
    });

    it('blocks invalid state code', () => {
      expect(() =>
        svc.assertMoneyActionAllowed({ country: 'US', state: 'ZZ' }),
      ).toThrow(ForbiddenException);
    });
  });
});
