import { z } from 'zod';
import {
  HotWalletType,
  Network,
  PaymentType,
  PurchasingAction,
  TransactionStatus,
  PurchaseErrorType,
  OnChainState,
  PricingType,
  $Enums,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';
import { checkSignature, resolvePaymentKeyHash } from '@meshsdk/core';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { logger } from '@/utils/logger';
import { metadataSchema } from '../registry/wallet';
import { metadataToString } from '@/utils/converter/metadata-string-convert';
import { handlePurchaseCreditInit } from '@/services/token-credit';
import stringify from 'canonical-json';
import { getPublicKeyFromCoseKey } from '@/utils/converter/public-key-convert';
import { generateHash } from '@/utils/crypto';
import { validateHexString } from '@/utils/generator/contract-generator';
import { decodeBlockchainIdentifier } from '@/utils/generator/blockchain-identifier-generator';
import { HttpExistsError } from '@/utils/errors/http-exists-error';

export const queryPurchaseRequestSchemaInput = z.object({
  limit: z
    .number({ coerce: true })
    .min(1)
    .max(100)
    .default(10)
    .describe('The number of purchases to return'),
  cursorId: z
    .string()
    .optional()
    .describe(
      'Used to paginate through the purchases. If this is provided, cursorId is required',
    ),
  network: z
    .nativeEnum(Network)
    .describe('The network the purchases were made on'),
  filterSmartContractAddress: z
    .string()
    .optional()
    .nullable()
    .describe('The smart contract address of the payment source'),

  includeHistory: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() == 'true')
    .default('false')
    .describe(
      'Whether to include the full transaction and status history of the purchases',
    ),
});

export const queryPurchaseRequestSchemaOutput = z.object({
  Purchases: z.array(
    z.object({
      id: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
      blockchainIdentifier: z.string(),
      lastCheckedAt: z.date().nullable(),
      payByTime: z.string().nullable(),
      submitResultTime: z.string(),
      unlockTime: z.string(),
      externalDisputeUnlockTime: z.string(),
      requestedById: z.string(),
      onChainState: z.nativeEnum(OnChainState).nullable(),
      collateralReturnLovelace: z.string().nullable(),
      cooldownTime: z.number(),
      cooldownTimeOtherParty: z.number(),
      inputHash: z.string(),
      resultHash: z.string(),
      NextAction: z.object({
        inputHash: z.string(),
        requestedAction: z.nativeEnum(PurchasingAction),
        errorType: z.nativeEnum(PurchaseErrorType).nullable(),
        errorNote: z.string().nullable(),
      }),
      CurrentTransaction: z
        .object({
          id: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          txHash: z.string(),
          status: z.nativeEnum(TransactionStatus),
        })
        .nullable(),
      TransactionHistory: z.array(
        z.object({
          id: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          txHash: z.string(),
          status: z.nativeEnum(TransactionStatus),
        }),
      ),
      PaidFunds: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      WithdrawnForSeller: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      WithdrawnForBuyer: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      PaymentSource: z.object({
        id: z.string(),
        network: z.nativeEnum(Network),
        smartContractAddress: z.string(),
        policyId: z.string().nullable(),
        paymentType: z.nativeEnum(PaymentType),
      }),
      SellerWallet: z
        .object({
          id: z.string(),
          walletVkey: z.string(),
        })
        .nullable(),
      SmartContractWallet: z
        .object({
          id: z.string(),
          walletVkey: z.string(),
          walletAddress: z.string(),
        })
        .nullable(),
      metadata: z.string().nullable(),
    }),
  ),
});

export const queryPurchaseRequestGet = payAuthenticatedEndpointFactory.build({
  method: 'get',
  input: queryPurchaseRequestSchemaInput,
  output: queryPurchaseRequestSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof queryPurchaseRequestSchemaInput>;
    options: {
      id: string;
      permission: $Enums.Permission;
      networkLimit: $Enums.Network[];
      usageLimited: boolean;
    };
  }) => {
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );

    const result = await prisma.purchaseRequest.findMany({
      where: {
        PaymentSource: {
          deletedAt: null,
          network: input.network,
          smartContractAddress: input.filterSmartContractAddress ?? undefined,
        },
      },
      cursor: input.cursorId ? { id: input.cursorId } : undefined,
      take: input.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        SellerWallet: true,
        SmartContractWallet: { where: { deletedAt: null } },
        PaidFunds: true,
        NextAction: true,
        PaymentSource: true,
        CurrentTransaction: true,
        WithdrawnForSeller: true,
        WithdrawnForBuyer: true,
        TransactionHistory: {
          orderBy: { createdAt: 'desc' },
          take: input.includeHistory == true ? undefined : 0,
        },
      },
    });
    if (result == null) {
      throw createHttpError(404, 'Purchase not found');
    }
    return {
      Purchases: result.map((purchase) => ({
        ...purchase,
        PaidFunds: (
          purchase.PaidFunds as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          ...amount,
          amount: amount.amount.toString(),
        })),
        WithdrawnForSeller: (
          purchase.WithdrawnForSeller as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          unit: amount.unit,
          amount: amount.amount.toString(),
        })),
        WithdrawnForBuyer: (
          purchase.WithdrawnForBuyer as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          unit: amount.unit,
          amount: amount.amount.toString(),
        })),
        collateralReturnLovelace:
          purchase.collateralReturnLovelace?.toString() ?? null,
        payByTime: purchase.payByTime?.toString() ?? null,
        submitResultTime: purchase.submitResultTime.toString(),
        unlockTime: purchase.unlockTime.toString(),
        externalDisputeUnlockTime:
          purchase.externalDisputeUnlockTime.toString(),
        cooldownTime: Number(purchase.buyerCoolDownTime),
        cooldownTimeOtherParty: Number(purchase.sellerCoolDownTime),
      })),
    };
  },
});

export const createPurchaseInitSchemaInput = z.object({
  blockchainIdentifier: z
    .string()
    .max(8000)
    .describe('The identifier of the purchase. Is provided by the seller'),
  network: z
    .nativeEnum(Network)
    .describe('The network the transaction will be made on'),
  inputHash: z
    .string()
    .max(250)
    .describe(
      'The hash of the input data of the purchase, should be sha256 hash of the input data, therefore needs to be in hex string format',
    ),
  sellerVkey: z
    .string()
    .max(250)
    .describe('The verification key of the seller'),
  agentIdentifier: z
    .string()
    .min(57)
    .max(250)
    .describe('The identifier of the agent that is being purchased'),
  Amounts: z
    .array(z.object({ amount: z.string().max(25), unit: z.string().max(150) }))
    .max(7)
    .optional()
    .describe('The amounts to be paid for the purchase'),
  paymentType: z
    .nativeEnum(PaymentType)
    .describe('The payment type of smart contract used'),
  unlockTime: z
    .string()
    .describe(
      'The time after which the purchase will be unlocked. In unix time (number)',
    ),
  externalDisputeUnlockTime: z
    .string()
    .describe(
      'The time after which the purchase will be unlocked for external dispute. In unix time (number)',
    ),
  submitResultTime: z
    .string()
    .describe(
      'The time by which the result has to be submitted. In unix time (number)',
    ),
  payByTime: z
    .string()
    .describe(
      'The time after which the purchase has to be submitted to the smart contract',
    ),
  metadata: z
    .string()
    .optional()
    .describe('Metadata to be stored with the purchase request'),
  identifierFromPurchaser: z
    .string()
    .min(14)
    .max(26)
    .describe(
      'The nonce of the purchaser of the purchase, needs to be in hex format',
    ),
});

export const createPurchaseInitSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  blockchainIdentifier: z.string(),
  lastCheckedAt: z.date().nullable(),
  payByTime: z.string().nullable(),
  submitResultTime: z.string(),
  unlockTime: z.string(),
  externalDisputeUnlockTime: z.string(),
  requestedById: z.string(),
  resultHash: z.string(),
  inputHash: z.string(),
  onChainState: z.nativeEnum(OnChainState).nullable(),
  NextAction: z.object({
    requestedAction: z.nativeEnum(PurchasingAction),
    errorType: z.nativeEnum(PurchaseErrorType).nullable(),
    errorNote: z.string().nullable(),
  }),
  CurrentTransaction: z
    .object({
      id: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
      txHash: z.string(),
      status: z.nativeEnum(TransactionStatus),
    })
    .nullable(),
  PaidFunds: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  WithdrawnForSeller: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  WithdrawnForBuyer: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  PaymentSource: z.object({
    id: z.string(),
    network: z.nativeEnum(Network),
    policyId: z.string().nullable(),
    smartContractAddress: z.string(),
    paymentType: z.nativeEnum(PaymentType),
  }),
  SellerWallet: z
    .object({
      id: z.string(),
      walletVkey: z.string(),
    })
    .nullable(),
  SmartContractWallet: z
    .object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
    })
    .nullable(),
  metadata: z.string().nullable(),
});

export const createPurchaseInitPost = payAuthenticatedEndpointFactory.build({
  method: 'post',
  input: createPurchaseInitSchemaInput,
  output: createPurchaseInitSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof createPurchaseInitSchemaInput>;
    options: {
      id: string;
      permission: $Enums.Permission;
      networkLimit: $Enums.Network[];
      usageLimited: boolean;
    };
  }) => {
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );
    const existingPurchaseRequest = await prisma.purchaseRequest.findUnique({
      where: {
        blockchainIdentifier: input.blockchainIdentifier,
        PaymentSource: {
          deletedAt: null,
          network: input.network,
        },
      },
      include: {
        SellerWallet: true,
        SmartContractWallet: { where: { deletedAt: null } },
        PaymentSource: true,
        WithdrawnForBuyer: true,
        WithdrawnForSeller: true,
        PaidFunds: true,
        NextAction: true,
        CurrentTransaction: true,
      },
    });
    if (existingPurchaseRequest != null) {
      throw new HttpExistsError('Purchase exists', existingPurchaseRequest.id, {
        ...existingPurchaseRequest,
        payByTime: existingPurchaseRequest.payByTime?.toString() ?? null,
        PaidFunds: (
          existingPurchaseRequest.PaidFunds as Array<{
            unit: string;
            amount: bigint;
          }>
        ).map((amount) => ({
          ...amount,
          amount: amount.amount.toString(),
        })),
        WithdrawnForSeller: (
          existingPurchaseRequest.WithdrawnForSeller as Array<{
            unit: string;
            amount: bigint;
          }>
        ).map((amount) => ({
          ...amount,
          amount: amount.amount.toString(),
        })),
        WithdrawnForBuyer: (
          existingPurchaseRequest.WithdrawnForBuyer as Array<{
            unit: string;
            amount: bigint;
          }>
        ).map((amount) => ({
          ...amount,
          amount: amount.amount.toString(),
        })),
        submitResultTime: existingPurchaseRequest.submitResultTime.toString(),
        unlockTime: existingPurchaseRequest.unlockTime.toString(),
        externalDisputeUnlockTime:
          existingPurchaseRequest.externalDisputeUnlockTime.toString(),
        cooldownTime: Number(existingPurchaseRequest.buyerCoolDownTime),
        cooldownTimeOtherParty: Number(
          existingPurchaseRequest.sellerCoolDownTime,
        ),
        collateralReturnLovelace:
          existingPurchaseRequest.collateralReturnLovelace?.toString() ?? null,
        metadata: existingPurchaseRequest.metadata,
        buyerCoolDownTime: existingPurchaseRequest.buyerCoolDownTime.toString(),
        sellerCoolDownTime:
          existingPurchaseRequest.sellerCoolDownTime.toString(),
      });
    }
    const policyId = input.agentIdentifier.substring(0, 56);

    const paymentSource = await prisma.paymentSource.findFirst({
      where: {
        policyId: policyId,
        network: input.network,
        deletedAt: null,
      },
      include: { PaymentSourceConfig: true },
    });
    const inputHash = input.inputHash;
    if (validateHexString(inputHash) == false) {
      throw createHttpError(400, 'Input hash is not a valid hex string');
    }

    if (paymentSource == null) {
      throw createHttpError(
        404,
        'No payment source found for agent identifiers policy id',
      );
    }

    const wallets = await prisma.hotWallet.aggregate({
      where: {
        paymentSourceId: paymentSource.id,
        type: HotWalletType.Selling,
        deletedAt: null,
      },
      _count: true,
    });
    if (wallets._count === 0) {
      throw createHttpError(404, 'No valid purchasing wallets found');
    }
    //require at least 3 hours between unlock time and the submit result time
    const additionalExternalDisputeUnlockTime = BigInt(1000 * 60 * 15);
    const submitResultTime = BigInt(input.submitResultTime);
    const payByTime = BigInt(input.payByTime);
    const unlockTime = BigInt(input.unlockTime);
    const externalDisputeUnlockTime = BigInt(input.externalDisputeUnlockTime);
    if (payByTime > submitResultTime - BigInt(1000 * 60 * 5)) {
      throw createHttpError(
        400,
        'Pay by time must be before submit result time (min. 5 minutes)',
      );
    }
    if (payByTime < BigInt(Date.now() - 1000 * 60 * 5)) {
      throw createHttpError(
        400,
        'Pay by time must be in the future (max. 5 minutes)',
      );
    }

    if (
      externalDisputeUnlockTime <
      unlockTime + additionalExternalDisputeUnlockTime
    ) {
      throw createHttpError(
        400,
        'External dispute unlock time must be after unlock time (min. 15 minutes difference)',
      );
    }
    if (submitResultTime < BigInt(Date.now() + 1000 * 60 * 15)) {
      throw createHttpError(
        400,
        'Submit result time must be in the future (min. 15 minutes)',
      );
    }
    const offset = BigInt(1000 * 60 * 15);
    if (submitResultTime > unlockTime - offset) {
      throw createHttpError(
        400,
        'Submit result time must be before unlock time with at least 15 minutes difference',
      );
    }
    const provider = new BlockFrostAPI({
      projectId: paymentSource.PaymentSourceConfig.rpcProviderApiKey,
    });

    const assetId = input.agentIdentifier;
    const policyAsset = assetId.startsWith(policyId)
      ? assetId
      : policyId + assetId;
    const assetInWallet = await provider.assetsAddresses(policyAsset, {
      order: 'desc',
      count: 1,
    });

    if (assetInWallet.length == 0) {
      throw createHttpError(404, 'Agent identifier not found');
    }
    const addressOfAsset = assetInWallet[0].address;
    if (addressOfAsset == null) {
      throw createHttpError(404, 'Agent identifier not found');
    }

    const vKey = resolvePaymentKeyHash(addressOfAsset);
    if (vKey != input.sellerVkey) {
      throw createHttpError(400, 'Invalid seller vkey');
    }

    const assetInfo = await provider.assetsById(assetId);
    if (!assetInfo.onchain_metadata) {
      throw createHttpError(404, 'Agent identifier not found');
    }
    const parsedMetadata = metadataSchema.safeParse(assetInfo.onchain_metadata);

    if (!parsedMetadata.success || !parsedMetadata.data) {
      const error = parsedMetadata.error;
      logger.error('Error parsing metadata', { error });
      throw createHttpError(404, 'Agent identifier metadata invalid');
    }

    const pricing = parsedMetadata.data.agentPricing;
    if (pricing.pricingType != PricingType.Fixed) {
      throw createHttpError(400, 'Agent identifier pricing type not supported');
    }
    const amounts = pricing.fixedPricing;

    const agentIdentifierAmountsMap = new Map<string, bigint>();
    for (const amount of amounts) {
      const unit =
        metadataToString(amount.unit)!.toLowerCase() == ''
          ? ''
          : metadataToString(amount.unit)!;
      if (agentIdentifierAmountsMap.has(unit)) {
        agentIdentifierAmountsMap.set(
          unit,
          agentIdentifierAmountsMap.get(unit)! + BigInt(amount.amount),
        );
      } else {
        agentIdentifierAmountsMap.set(unit, BigInt(amount.amount));
      }
    }
    //for fixed pricing, the amounts must not be provided
    if (input.Amounts != undefined) {
      throw createHttpError(
        400,
        'Agent identifier amounts must not be provided for fixed pricing',
      );
    }
    const decoded = decodeBlockchainIdentifier(input.blockchainIdentifier);
    if (decoded == null) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, format invalid',
      );
    }
    const purchaserId = decoded.purchaserId;
    const sellerId = decoded.sellerId;
    const signature = decoded.signature;
    const key = decoded.key;

    if (purchaserId != input.identifierFromPurchaser) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, purchaser id mismatch',
      );
    }
    if (validateHexString(purchaserId) == false) {
      throw createHttpError(
        400,
        'Purchaser identifier is not a valid hex string',
      );
    }
    if (validateHexString(sellerId) == false) {
      throw createHttpError(400, 'Seller identifier is not a valid hex string');
    }
    if (decoded.agentIdentifier != input.agentIdentifier) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, agent identifier mismatch',
      );
    }

    const cosePublicKey = getPublicKeyFromCoseKey(key);
    if (cosePublicKey == null) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, key not found',
      );
    }
    const publicKeyHash = cosePublicKey.hash();
    if (publicKeyHash.hex() != input.sellerVkey) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, key does not match',
      );
    }

    const reconstructedBlockchainIdentifier = {
      inputHash: input.inputHash,
      agentIdentifier: input.agentIdentifier,
      purchaserIdentifier: purchaserId,
      sellerIdentifier: sellerId,
      //RequestedFunds: is null for fixed pricing
      RequestedFunds: null,
      payByTime: input.payByTime,
      submitResultTime: input.submitResultTime,
      unlockTime: unlockTime.toString(),
      externalDisputeUnlockTime: externalDisputeUnlockTime.toString(),
      sellerAddress: addressOfAsset,
    };

    const hashedBlockchainIdentifier = generateHash(
      stringify(reconstructedBlockchainIdentifier),
    );

    const identifierIsSignedCorrectly = await checkSignature(
      hashedBlockchainIdentifier,
      {
        signature: signature,
        key: key,
      },
    );
    if (!identifierIsSignedCorrectly) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, signature invalid',
      );
    }
    const smartContractAddress = paymentSource.smartContractAddress;

    const initialPurchaseRequest = await handlePurchaseCreditInit({
      id: options.id,
      cost: Array.from(agentIdentifierAmountsMap.entries()).map(
        ([unit, amount]) => {
          if (unit.toLowerCase() == 'lovelace') {
            return { amount: amount, unit: '' };
          } else {
            return { amount: amount, unit: unit };
          }
        },
      ),
      metadata: input.metadata,
      network: input.network,
      blockchainIdentifier: input.blockchainIdentifier,
      paymentType: input.paymentType,
      contractAddress: smartContractAddress,
      sellerVkey: input.sellerVkey,
      sellerAddress: addressOfAsset,
      payByTime: payByTime,
      submitResultTime: submitResultTime,
      unlockTime: unlockTime,
      externalDisputeUnlockTime: externalDisputeUnlockTime,
      inputHash: input.inputHash,
    });

    return {
      ...initialPurchaseRequest,
      payByTime: initialPurchaseRequest.payByTime?.toString() ?? null,
      PaidFunds: (
        initialPurchaseRequest.PaidFunds as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      WithdrawnForSeller: (
        initialPurchaseRequest.WithdrawnForSeller as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      WithdrawnForBuyer: (
        initialPurchaseRequest.WithdrawnForBuyer as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      submitResultTime: initialPurchaseRequest.submitResultTime.toString(),
      unlockTime: initialPurchaseRequest.unlockTime.toString(),
      externalDisputeUnlockTime:
        initialPurchaseRequest.externalDisputeUnlockTime.toString(),
    };
  },
});
