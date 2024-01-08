import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CallerWrapper } from "../target/types/caller_wrapper";
import { Callee } from "../target/types/callee";
import { assert } from "chai";
import { Caller } from "../target/types/caller";
import { PRE_INSTRUCTIONS, sendTransaction } from "./lib/sendTransaction";
import {
  callSwapOnDelegate,
  callTransferOnBase,
  callTransferOnDelegate,
  callTransferOnSuperDelegate,
} from "./lib/interface";
import {
  ObjectCreationMeta,
  airdrop,
  createLinkedList,
  setupBankrun,
  validateLinkedListTransfer,
  validateOwnershipListTransfer,
} from "./lib/utils";

describe("nested-account-resolution", () => {
  let provider: anchor.Provider;
  let program: Program<Callee>;
  let caller: Program<Caller>;
  let callerWrapper: Program<CallerWrapper>;
  let payer: anchor.web3.PublicKey;

  beforeEach(async () => {
    const setup = await setupBankrun();
    provider = setup.provider;
    program = setup.callee;
    caller = setup.caller;
    callerWrapper = setup.callerWrapper;
    payer = setup.provider.publicKey;
  });

  describe("Ownership List tests", () => {
    // for (const i of [131, 200, 230]) {
    // for (const i of [125]) (works on devnet account resolution)
    for (const i of [1, 2, 31]) {
      const NUM_NODES = i;

      describe(`With ${NUM_NODES} nodes`, () => {
        let ownershipListKp: anchor.web3.Keypair;
        let ownershipList: anchor.web3.PublicKey;
        let destination: anchor.web3.PublicKey;
        beforeEach(async () => {
          ownershipListKp = anchor.web3.Keypair.generate();
          ownershipList = ownershipListKp.publicKey;

          await program.methods
            .createOwnershipList(NUM_NODES)
            .accounts({
              payer,
              ownershipList,
            })
            .preInstructions(PRE_INSTRUCTIONS)
            .signers([ownershipListKp])
            .rpc({ skipPreflight: false, commitment: "confirmed" });

          destination = anchor.web3.Keypair.generate().publicKey;
        });

        it(`Can transfer an ownership list (${NUM_NODES})`, async () => {
          const computeUnits = await callTransferOnBase(
            provider.connection,
            program.programId,
            "transfer_ownership_list",
            {
              object: ownershipList,
              destination,
            },
            {
              useLookupTable: true,
            }
          );

          console.log({ num: NUM_NODES, computeUnits });
          await validateOwnershipListTransfer(
            program,
            ownershipList,
            destination
          );
        });

        it(`Can transfer an ownership list (${NUM_NODES}) via CPI`, async () => {
          const computeUnits = await callTransferOnDelegate(
            provider.connection,
            caller.programId,
            {
              programId: program.programId,
              object: ownershipList,
              destination,
            },
            {
              useLookupTable: true,
            }
          );

          console.log({ num: NUM_NODES, computeUnits });
          await validateOwnershipListTransfer(
            program,
            ownershipList,
            destination
          );
        });

        it(`Can transfer an ownership list (${NUM_NODES}) via CPI-CPI`, async () => {
          // Now perform the thing
          const computeUnits = await callTransferOnSuperDelegate(
            provider.connection,
            callerWrapper.programId,
            {
              delegateProgramId: caller.programId,
              programId: program.programId,
              object: ownershipList,
              destination,
            },
            {
              useLookupTable: true,
            }
          );
          console.log({ num: NUM_NODES, computeUnits });

          await validateOwnershipListTransfer(
            program,
            ownershipList,
            destination
          );
        });
      });
    }
  });

  describe("Swap tests", () => {
    let ownerBKp = anchor.web3.Keypair.generate();
    let ownerB = ownerBKp.publicKey;

    for (const i of [1, 2, 25]) {
      const NUM_NODES = i;

      describe(`With Ownership Lists Containing ${NUM_NODES} Accounts`, () => {
        let ownershipListKpA: anchor.web3.Keypair;
        let ownershipListA: anchor.web3.PublicKey;

        let ownershipListKpB: anchor.web3.Keypair;
        let ownershipListB: anchor.web3.PublicKey;
        beforeEach(async () => {
          await airdrop(provider.connection, ownerB, 1);

          ownershipListKpA = anchor.web3.Keypair.generate();
          ownershipListA = ownershipListKpA.publicKey;

          await program.methods
            .createOwnershipList(NUM_NODES)
            .accounts({
              payer,
              ownershipList: ownershipListA,
            })
            .preInstructions(PRE_INSTRUCTIONS)
            .signers([ownershipListKpA])
            .rpc({ skipPreflight: false, commitment: "confirmed" });

          ownershipListKpB = anchor.web3.Keypair.generate();
          ownershipListB = ownershipListKpB.publicKey;

          await program.methods
            .createOwnershipList(NUM_NODES)
            .accounts({
              payer: ownerB,
              ownershipList: ownershipListB,
            })
            .preInstructions(PRE_INSTRUCTIONS)
            .signers([ownerBKp, ownershipListKpB])
            .rpc({ skipPreflight: false, commitment: "confirmed" });
        });

        it("Can swap ownership list for ownership list", async () => {
          const computeUnits = await callSwapOnDelegate(
            provider.connection,
            caller.programId,
            {
              programId: program.programId,
              ownerA: payer,
              objectA: ownershipListA,
              ownerB,
              objectB: ownershipListB,
            },
            {
              useLookupTable: true,
              signers: [ownerBKp],
            }
          );

          console.log({ num: NUM_NODES, computeUnits });
          await validateOwnershipListTransfer(program, ownershipListA, ownerB);
          await validateOwnershipListTransfer(program, ownershipListB, payer);
        });
      });
    }

    // We're throttled at 9 accounts per linkedlist because
    // we can only create a linked list of size 9 for ownerB's keypair.
    // In other LL tests we can do 10, but creating for ownerB requires addnl pubkey + sig
    for (const i of [1, 2, 9]) {
      const NUM_NODES = i;
      describe(`With Linked Lists Containing ${NUM_NODES} Accounts`, () => {
        let linkedListA: anchor.web3.PublicKey;
        let listAInfo: ObjectCreationMeta;

        let linkedListB: anchor.web3.PublicKey;
        let listBInfo: ObjectCreationMeta;
        beforeEach(async () => {
          await airdrop(provider.connection, ownerB, 1);

          listAInfo = await createLinkedList(program, NUM_NODES);
          linkedListA = listAInfo.signers[0].publicKey;

          listBInfo = await createLinkedList(program, NUM_NODES, {
            payer: ownerBKp,
          });
          linkedListB = listBInfo.signers[0].publicKey;
        });

        it("Can swap linked list for linked list", async () => {
          const computeUnits = await callSwapOnDelegate(
            provider.connection,
            caller.programId,
            {
              programId: program.programId,
              ownerA: payer,
              objectA: linkedListA,
              ownerB,
              objectB: linkedListB,
            },
            {
              useLookupTable: true,
              signers: [ownerBKp],
            }
          );

          console.log({ num: NUM_NODES, computeUnits });
          await validateLinkedListTransfer(
            program,
            listAInfo.signers,
            NUM_NODES,
            ownerB
          );
          await validateLinkedListTransfer(
            program,
            listBInfo.signers,
            NUM_NODES,
            payer
          );
        });
      });
    }
  });
});
