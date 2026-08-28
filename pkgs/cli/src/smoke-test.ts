/**
 * Real-network smoke test: deploys Umbra to the local Midnight network and
 * runs a full submit -> grade -> reveal cycle with REAL proof generation
 * (via the local proof server) and REAL on-chain state, not the simulator.
 *
 * One funded wallet plays both roles (grader and submitter) -- see
 * setUmbraIdentity() in api.ts for why that's safe: the contract only ever
 * sees a derived key from whichever logical secretKey is "active" in
 * private state when a circuit runs, never the underlying wallet identity.
 *
 * Usage:
 *   npm run smoke-test --workspace=@umbra/cli
 * This will print an unshielded address and block waiting for funds. Fund
 * it from a second terminal via midnight-local-dev, e.g.:
 *   cd ../../../midnight-local-dev && npm start
 *   -> [2] Fund accounts by public key, paste the printed address
 */

import { StandaloneConfig } from "./config.js";
import {
  buildFreshWallet,
  configureUmbraProviders,
  setUmbraIdentity,
  deployUmbra,
  submitUmbra,
  gradeUmbra,
  revealUmbra,
  getUmbraState,
  pureCircuits,
} from "./api.js";
import { initialUmbraPrivateState } from "@umbra/contract";

const randomBytes32 = (): Uint8Array => {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return b;
};

async function main() {
  const config = new StandaloneConfig();

  console.log("\n=== Umbra real-network smoke test ===\n");

  const walletCtx = await buildFreshWallet(config);
  const providers = await configureUmbraProviders(walletCtx, config);

  // Two logical identities, both operating through the one funded wallet.
  const graderSecretKey = randomBytes32();
  const aliceSecretKey = randomBytes32();
  const graderKey = pureCircuits.derive_pk(graderSecretKey);

  const assignmentId = randomBytes32();
  const workHash = randomBytes32();
  const salt = randomBytes32();

  console.log("\n--- Deploy ---");
  const contract = await deployUmbra(
    providers,
    initialUmbraPrivateState(graderSecretKey),
    assignmentId,
    graderKey,
  );
  const contractAddress = contract.deployTxData.public.contractAddress;

  console.log("\n--- Submit (as Alice) ---");
  await setUmbraIdentity(providers, aliceSecretKey, { workHash, salt });
  await submitUmbra(contract);

  let state = await getUmbraState(providers, contractAddress);
  console.log(`After submit: submission_count=${state?.submission_count}`);

  console.log("\n--- Grade (as the grader) ---");
  await setUmbraIdentity(providers, graderSecretKey);
  await gradeUmbra(contract, 0n, 85n);

  state = await getUmbraState(providers, contractAddress);
  console.log(`After grade: graded_ids has 0 = ${state?.graded_ids.member(0n)}, grade = ${state?.grades.lookup(0n)}`);

  console.log("\n--- Reveal (as Alice again) ---");
  await setUmbraIdentity(providers, aliceSecretKey, { workHash, salt });
  await revealUmbra(contract, 0n);

  state = await getUmbraState(providers, contractAddress);
  console.log(`After reveal: revealed_ids has 0 = ${state?.revealed_ids.member(0n)}`);

  console.log("\n=== Done: submit -> blind grade -> reveal all confirmed on-chain ===");
  console.log(`Contract address: ${contractAddress}`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error("Smoke test failed:", e);
  process.exit(1);
});
