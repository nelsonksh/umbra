import {
  type CircuitContext,
  type ChargedState,
  type EncodedZswapLocalState,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  type Witnesses,
  pureCircuits,
} from "../managed/umbra/contract/index.js";
import {
  type UmbraPrivateState,
  umbraWitnesses,
  initialUmbraPrivateState,
} from "../umbra-witnesses.js";

export { pureCircuits };

type ApplyResult = {
  context: {
    currentPrivateState: UmbraPrivateState;
    currentZswapLocalState: EncodedZswapLocalState;
    currentQueryContext: { state: ChargedState };
  };
};

/**
 * Umbra contract simulator for unit testing.
 * Executes impureCircuits directly (no ZK proof generation).
 *
 * Usage:
 *   const sim = new UmbraSimulator();
 *   sim.join("alice", ALICE_KEY);
 *   sim.setWork("alice", workHash, salt);
 *   sim.submit("alice");
 *   sim.grade(0n, 85n);
 *   sim.reveal("alice", 0n);
 */
export class UmbraSimulator {
  private readonly contract: Contract<UmbraPrivateState>;
  private readonly contractAddress = sampleContractAddress();
  private readonly assignmentId: Uint8Array;
  readonly graderKey: Uint8Array;

  private sharedState: ChargedState;
  private readonly participants = new Map<
    string,
    { privateState: UmbraPrivateState; zswap: EncodedZswapLocalState }
  >();

  constructor(
    assignmentId: Uint8Array = new Uint8Array(32),
    graderSecretKey: Uint8Array = new Uint8Array(32).fill(9),
  ) {
    this.contract = new Contract<UmbraPrivateState>(
      umbraWitnesses as unknown as Witnesses<UmbraPrivateState>,
    );
    this.assignmentId = assignmentId;
    this.graderKey = pureCircuits.derive_pk(graderSecretKey);

    const graderPs = initialUmbraPrivateState(graderSecretKey);
    const init = this.contract.initialState(
      createConstructorContext(graderPs, "0".repeat(64)),
      assignmentId,
      this.graderKey,
    );
    this.sharedState = init.currentContractState.data;
    this.participants.set("grader", {
      privateState: graderPs,
      zswap: init.currentZswapLocalState,
    });
  }

  getLedger(): Ledger {
    return ledger(this.sharedState);
  }

  /** Register a new submitter under a name, with their own secret key. */
  join(name: string, secretKey: Uint8Array): void {
    const ps = initialUmbraPrivateState(secretKey);
    // initialState() is called again purely to mint a fresh, valid zswap
    // local state for this identity -- the constructor result's ledger data
    // is discarded (the real shared ledger was already fixed at genesis).
    const init = this.contract.initialState(
      createConstructorContext(ps, "0".repeat(64)),
      this.assignmentId,
      this.graderKey,
    );
    this.participants.set(name, {
      privateState: ps,
      zswap: init.currentZswapLocalState,
    });
  }

  setWork(name: string, workHash: Uint8Array, salt: Uint8Array): void {
    const p = this.participants.get(name);
    if (!p) throw new Error(`Unknown participant: ${name}`);
    p.privateState = { ...p.privateState, workHash, salt };
  }

  private ctxFor(name: string): CircuitContext<UmbraPrivateState> {
    const p = this.participants.get(name);
    if (!p) throw new Error(`Unknown participant: ${name}`);
    return createCircuitContext(
      this.contractAddress,
      p.zswap,
      this.sharedState,
      p.privateState,
    );
  }

  private applyResult(name: string, result: ApplyResult): Ledger {
    const p = this.participants.get(name);
    if (!p) throw new Error(`Unknown participant: ${name}`);
    p.privateState = result.context.currentPrivateState;
    p.zswap = result.context.currentZswapLocalState;
    this.sharedState = result.context.currentQueryContext.state;
    return ledger(this.sharedState);
  }

  submit(name: string): Ledger {
    const result = this.contract.impureCircuits.submit(this.ctxFor(name));
    return this.applyResult(name, result);
  }

  grade(id: bigint, score: bigint): Ledger {
    return this.gradeAs("grader", id, score);
  }

  /** Call grade() as an arbitrary participant -- used to test that only the
   * true grader (matching grader_key) is authorized. */
  gradeAs(name: string, id: bigint, score: bigint): Ledger {
    const result = this.contract.impureCircuits.grade(
      this.ctxFor(name),
      id,
      score,
    );
    return this.applyResult(name, result);
  }

  reveal(name: string, id: bigint): Ledger {
    const result = this.contract.impureCircuits.reveal(this.ctxFor(name), id);
    return this.applyResult(name, result);
  }
}
