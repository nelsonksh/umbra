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
 *   npm run smoke-test --workspace=@umbra/cli            # local network (default)
 *   npm run smoke-test:preview --workspace=@umbra/cli    # public Preview testnet
 *   npm run smoke-test:preprod --workspace=@umbra/cli    # public Preprod testnet
 *
 * Either way this prints an unshielded address and blocks waiting for
 * funds:
 *   - local: fund it from a second terminal via midnight-local-dev, e.g.
 *     `cd ../../../midnight-local-dev && npm start` -> [2] Fund accounts by
 *     public key, paste the printed address.
 *   - preview/preprod: paste the printed address into the matching faucet
 *     (https://faucet.preview.midnight.network/ or
 *     https://faucet.preprod.midnight.network/) -- both have a
 *     human-verification check, so this step can't be automated.
 *
 * Prefer preview over preprod: preprod has ~4x the chain history (as of
 * writing), and a from-scratch wallet sync against it can take 25+ minutes
 * and needs a raised --max-old-space-size (see package.json scripts) to
 * avoid an OOM crash.
 */

import { StandaloneConfig, PreviewConfig, PreprodConfig } from "./config.js";
import {
  buildFreshWallet,
  buildWalletAndWaitForFunds,
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
  const network = process.argv[2] ?? "standalone";
  const config =
    network === "preprod" ? new PreprodConfig() :
    network === "preview" ? new PreviewConfig() :
    new StandaloneConfig();

  console.log(`\n=== Umbra real-network smoke test (${network}) ===\n`);

  // UMBRA_WALLET_SEED lets a retry reuse an already-funded address instead
  // of generating a fresh one and needing a new faucet grant.
  const reuseSeed = process.env.UMBRA_WALLET_SEED;
  const walletCtx = reuseSeed
    ? await buildWalletAndWaitForFunds(config, reuseSeed)
    : await buildFreshWallet(config);
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
