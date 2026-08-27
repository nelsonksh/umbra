import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, expect, it } from "vitest";
import { UmbraSimulator } from "./umbra-simulator.js";

setNetworkId("undeployed");

// Deterministic keys for reproducible tests
const ALICE_KEY = new Uint8Array(32).fill(1);
const BOB_KEY = new Uint8Array(32).fill(2);
const MALLORY_KEY = new Uint8Array(32).fill(3);
const GRADER_KEY = new Uint8Array(32).fill(9);

const WORK_A = new Uint8Array(32).fill(0xa1);
const SALT_A = new Uint8Array(32).fill(0xaa);
const WORK_B = new Uint8Array(32).fill(0xb1);
const SALT_B = new Uint8Array(32).fill(0xbb);

function newSim(): UmbraSimulator {
  return new UmbraSimulator(new Uint8Array(32).fill(7) /* assignment id */, GRADER_KEY);
}

describe("Umbra contract", () => {
  describe("initial ledger state", () => {
    it("starts empty, with no submissions, grades, or reveals", () => {
      const sim = newSim();
      const l = sim.getLedger();
      expect(l.submission_count).toBe(0n);
      expect(l.commitments.isEmpty()).toBe(true);
      expect(l.grades.isEmpty()).toBe(true);
      expect(l.graded_ids.isEmpty()).toBe(true);
      expect(l.revealed_ids.isEmpty()).toBe(true);
      expect(l.nullifiers.isEmpty()).toBe(true);
    });
  });

  describe("submit()", () => {
    it("records a commitment and an opaque owner key under a fresh id, with no identity attached", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      const l = sim.submit("alice");

      expect(l.submission_count).toBe(1n);
      expect(l.commitments.member(0n)).toBe(true);
      expect(l.owner_keys.member(0n)).toBe(true);
      // The ledger never records anything resembling "alice" -- only a hash.
      expect(l.owner_keys.lookup(0n)).not.toEqual(ALICE_KEY);
    });

    it("assigns increasing ids to independent submitters", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");

      sim.join("bob", BOB_KEY);
      sim.setWork("bob", WORK_B, SALT_B);
      const l = sim.submit("bob");

      expect(l.submission_count).toBe(2n);
      expect(l.commitments.member(0n)).toBe(true);
      expect(l.commitments.member(1n)).toBe(true);
      expect(l.commitments.lookup(0n)).not.toEqual(l.commitments.lookup(1n));
    });

    it("rejects a second submission from the same secret key for the same assignment", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");

      sim.setWork("alice", WORK_B, SALT_B);
      expect(() => sim.submit("alice")).toThrow(/already submitted/i);
    });
  });

  describe("grade()", () => {
    it("rejects grading from anyone but the authorized grader", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");

      // Mallory holds no relationship to grader_key -- calling grade() as her
      // should be rejected regardless of the (valid) submission id.
      sim.join("mallory", MALLORY_KEY);
      expect(() => sim.gradeAs("mallory", 0n, 99n)).toThrow(/not the authorized grader/i);
    });

    it("scores a submission by id alone and marks it graded", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");

      const l = sim.grade(0n, 85n);
      expect(l.graded_ids.member(0n)).toBe(true);
      expect(l.grades.lookup(0n)).toBe(85n);
    });

    it("rejects grading an id that was already graded", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");
      sim.grade(0n, 85n);

      expect(() => sim.grade(0n, 40n)).toThrow(/already graded/i);
    });

    it("rejects grading an id that was never submitted", () => {
      const sim = newSim();
      expect(() => sim.grade(0n, 85n)).toThrow(/no such submission/i);
    });
  });

  describe("reveal()", () => {
    it("rejects revealing before the submission is graded", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");

      expect(() => sim.reveal("alice", 0n)).toThrow(/not graded yet/i);
    });

    it("rejects reveal from someone who is not the submission's owner", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");
      sim.grade(0n, 85n);

      sim.join("mallory", MALLORY_KEY);
      sim.setWork("mallory", WORK_A, SALT_A); // even with the right work+salt --
      expect(() => sim.reveal("mallory", 0n)).toThrow(/not the submission owner/i);
    });

    it("rejects reveal with the right owner but mismatched work/salt", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");
      sim.grade(0n, 85n);

      sim.setWork("alice", WORK_B, SALT_B); // wrong content this time
      expect(() => sim.reveal("alice", 0n)).toThrow(/commitment mismatch/i);
    });

    it("lets the true owner claim a graded submission, exactly once", () => {
      const sim = newSim();
      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice");
      sim.grade(0n, 85n);

      const l = sim.reveal("alice", 0n);
      expect(l.revealed_ids.member(0n)).toBe(true);
      expect(l.grades.lookup(0n)).toBe(85n);

      expect(() => sim.reveal("alice", 0n)).toThrow(/already revealed/i);
    });
  });

  describe("end-to-end: two submitters, blind grading, independent reveals", () => {
    it("keeps grading blind to identity and lets each submitter claim only their own grade", () => {
      const sim = newSim();

      sim.join("alice", ALICE_KEY);
      sim.setWork("alice", WORK_A, SALT_A);
      sim.submit("alice"); // -> id 0

      sim.join("bob", BOB_KEY);
      sim.setWork("bob", WORK_B, SALT_B);
      sim.submit("bob"); // -> id 1

      // Grader only ever sees ids 0 and 1 -- no names, no wallets.
      sim.grade(0n, 60n);
      sim.grade(1n, 95n);

      // Bob cannot claim Alice's grade, even knowing her id.
      expect(() => sim.reveal("bob", 0n)).toThrow(/not the submission owner/i);

      const l1 = sim.reveal("alice", 0n);
      expect(l1.grades.lookup(0n)).toBe(60n);

      const l2 = sim.reveal("bob", 1n);
      expect(l2.grades.lookup(1n)).toBe(95n);
    });
  });
});
