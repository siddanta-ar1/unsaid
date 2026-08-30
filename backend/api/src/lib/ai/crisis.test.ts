import { describe, expect, it } from 'vitest';
import { allCrisisRegions, crisisResourcesFor, unverifiedRegions } from './crisis.js';
import { detectHighRisk } from './prompt.js';

describe('crisis resources', () => {
  it('serves Nepal resources for the launch region', () => {
    const region = crisisResourcesFor('NP');
    expect(region.label).toBe('Nepal');
    expect(region.resources.length).toBeGreaterThan(0);
    expect(region.resources.some((resource) => resource.phone !== null)).toBe(true);
  });

  it('falls back to a directory rather than a wrong number', () => {
    // A wrong crisis number costs someone the attempt. When we do not know
    // where they are, point outward instead of guessing.
    for (const input of [null, undefined, '', 'ZZ', 'not-a-region']) {
      const region = crisisResourcesFor(input);
      expect(region.region).toBe('default');
      expect(region.resources[0]?.url).toContain('findahelpline');
    }
  });

  it('accepts a region hint in any casing', () => {
    expect(crisisResourcesFor('np').label).toBe('Nepal');
    expect(crisisResourcesFor(' Np ').label).toBe('Nepal');
  });

  it('gives every region at least one reachable route to a human', () => {
    for (const region of allCrisisRegions()) {
      const reachable = region.resources.some(
        (resource) => resource.phone !== null || resource.url !== undefined,
      );
      expect(reachable, `${region.label} has no reachable resource`).toBe(true);
    }
  });

  it('reports which regions have not been dialled by a human', () => {
    // This is the launch gate. It should stay non-empty until someone has
    // actually called each number — publishing a dead crisis line is worse
    // than publishing none.
    const unverified = unverifiedRegions();
    expect(Array.isArray(unverified)).toBe(true);
    for (const region of allCrisisRegions()) {
      if (region.verifiedOn === null) expect(unverified).toContain(region.label);
    }
  });
});

describe('the risk signal', () => {
  it('recognises plain statements of intent', () => {
    for (const phrase of [
      'sometimes I think I want to die',
      'I have been thinking about how to kill myself',
      'there is no reason to go on',
      'I want to end my life',
    ]) {
      expect(detectHighRisk(phrase), phrase).toBe(true);
    }
  });

  it('does not fire on ordinary heavy writing', () => {
    // False positives are not free: a support screen shown to someone merely
    // venting reads as surveillance, and teaches them the app is watching.
    for (const phrase of [
      'I am so tired of this job it is killing me',
      'that presentation was death by slides',
      'I could die of embarrassment',
      'my phone died again',
      'I am exhausted and sad and I do not know why',
    ]) {
      expect(detectHighRisk(phrase), phrase).toBe(false);
    }
  });
});
