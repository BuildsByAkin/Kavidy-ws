import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

export const US_STATES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
]);

export const RESTRICTED_STATES = new Set(['ID', 'MI', 'NV', 'WA']);

export const MINIMUM_AGE_YEARS = 18;

export interface EligibilityInput {
  dateOfBirth: string;
  state: string;
  country?: string;
}

@Injectable()
export class EligibilityService {
  normalizeState(state: string): string {
    return state.trim().toUpperCase();
  }

  isValidUsState(state: string): boolean {
    return US_STATES.has(this.normalizeState(state));
  }

  isStateRestricted(state: string): boolean {
    return RESTRICTED_STATES.has(this.normalizeState(state));
  }

  computeAgeYears(dateOfBirth: string, now: Date = new Date()): number {
    const dob = new Date(`${dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid date of birth');
    }
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const m = now.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
      age--;
    }
    return age;
  }

  assertEligible(input: EligibilityInput): {
    state: string;
    country: string;
    dateOfBirth: string;
  } {
    const country = (input.country ?? 'US').trim().toUpperCase();
    if (country !== 'US') {
      throw new BadRequestException(
        'Only US residents are supported at this time',
      );
    }
    const state = this.normalizeState(input.state);
    if (!this.isValidUsState(state)) {
      throw new BadRequestException('Invalid US state code');
    }
    if (this.isStateRestricted(state)) {
      throw new BadRequestException(
        'We are not currently available in your state',
      );
    }
    const age = this.computeAgeYears(input.dateOfBirth);
    if (age < MINIMUM_AGE_YEARS) {
      throw new BadRequestException(
        `You must be at least ${MINIMUM_AGE_YEARS} years old to register`,
      );
    }
    return { state, country, dateOfBirth: input.dateOfBirth };
  }

  assertMoneyActionAllowed(input: {
    country: string | null | undefined;
    state: string | null | undefined;
  }): void {
    const country = (input.country ?? 'US').trim().toUpperCase();
    if (country !== 'US') {
      throw new ForbiddenException(
        'Real-money actions are only available to US residents',
      );
    }
    if (!input.state) {
      throw new ForbiddenException(
        'Complete your profile before performing money actions',
      );
    }
    const state = this.normalizeState(input.state);
    if (!this.isValidUsState(state)) {
      throw new ForbiddenException('Invalid US state on file');
    }
    if (this.isStateRestricted(state)) {
      throw new ForbiddenException(
        'Real-money actions are not available in your state',
      );
    }
  }
}
