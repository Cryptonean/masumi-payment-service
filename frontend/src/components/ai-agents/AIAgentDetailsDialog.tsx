/* eslint-disable react-hooks/rules-of-hooks */
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import useFormatBalance from '@/lib/hooks/useFormatBalance';
import { CopyButton } from '@/components/ui/copy-button';
import { USDM_CONFIG, TESTUSDM_CONFIG } from '@/lib/constants/defaultWallets';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useAppContext } from '@/lib/contexts/AppContext';
import { deleteRegistry } from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type AIAgent = {
  id: string;
  name: string;
  description: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
  agentIdentifier: string | null;
  Tags: string[];
  SmartContractWallet: {
    walletAddress: string;
    walletVkey: string;
  };
  AgentPricing?: {
    Pricing?: Array<{
      amount: string;
      unit: string;
    }>;
  };
};

interface AIAgentDetailsDialogProps {
  agent: AIAgent | null;
  onClose: () => void;
}

const parseAgentStatus = (status: AIAgent['state']): string => {
  switch (status) {
    case 'RegistrationRequested':
      return 'Pending';
    case 'RegistrationInitiated':
      return 'Registering';
    case 'RegistrationConfirmed':
      return 'Registered';
    case 'RegistrationFailed':
      return 'Registration Failed';
    case 'DeregistrationRequested':
      return 'Pending';
    case 'DeregistrationInitiated':
      return 'Deregistering';
    case 'DeregistrationConfirmed':
      return 'Deregistered';
    case 'DeregistrationFailed':
      return 'Deregistration Failed';
    default:
      return status;
  }
};

const getStatusBadgeVariant = (status: AIAgent['state']) => {
  if (status === 'RegistrationConfirmed') return 'default';
  if (status.includes('Failed')) return 'destructive';
  if (status.includes('Initiated')) return 'secondary';
  if (status.includes('Requested')) return 'secondary';
  if (status === 'DeregistrationConfirmed') return 'secondary';
  return 'secondary';
};

const useFormatPrice = (amount: string | undefined) => {
  if (!amount) return '—';
  return useFormatBalance((parseInt(amount) / 1000000).toFixed(2));
};

export function AIAgentDetailsDialog({
  agent,
  onClose,
}: AIAgentDetailsDialogProps) {
  const { apiClient, state } = useAppContext();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  const handleDelete = async () => {
    if (!agent?.agentIdentifier) {
      toast.error('Cannot delete agent: Missing identifier');
      return;
    }
    try {
      await deleteRegistry({
        client: apiClient,
        query: {
          agentIdentifier: agent.agentIdentifier,
          network: state.network,
          smartContractAddress: state.paymentSources?.[0]?.smartContractAddress,
        },
      });
      toast.success('AI agent deleted successfully');
      onClose();
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast.error('Failed to delete AI agent');
    }
  };

  return (
    <Dialog open={!!agent} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        {agent && (
          <>
            <DialogHeader
              onClick={() => {
                console.log(agent);
              }}
            >
              <DialogTitle>{agent.name}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4 max-h-[70vh] overflow-auto pb-20">
              {/* Description */}
              <div>
                <h3 className="font-medium mb-2">Description</h3>
                <p className="text-sm text-muted-foreground">
                  {agent.description || 'No description provided'}
                </p>
              </div>

              {/* Tags */}
              <div>
                <h3 className="font-medium mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {agent.Tags && agent.Tags.length > 0 ? (
                    agent.Tags.map((tag, index) => (
                      <Badge key={index} variant="secondary">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No tags
                    </span>
                  )}
                </div>
              </div>

              {/* Pricing */}
              <div>
                <h3 className="font-medium mb-2">Pricing Details</h3>
                <div className="space-y-2">
                  {agent.AgentPricing?.Pricing?.map((price, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 border-b"
                    >
                      <span className="text-sm text-muted-foreground">
                        Price (
                        {price.unit === 'lovelace' || !price.unit
                          ? 'ADA'
                          : price.unit === USDM_CONFIG.fullAssetId
                            ? 'USDM'
                            : price.unit === TESTUSDM_CONFIG.unit
                              ? 'tUSDM'
                              : price.unit}
                        )
                      </span>
                      <span className="font-medium">
                        {price.unit === 'lovelace' || !price.unit
                          ? `${useFormatPrice(price.amount)} ADA`
                          : `${useFormatPrice(price.amount)} ${price.unit === USDM_CONFIG.fullAssetId ? 'USDM' : price.unit === TESTUSDM_CONFIG.unit ? 'tUSDM' : price.unit}`}
                      </span>
                    </div>
                  ))}
                  {(!agent.AgentPricing?.Pricing ||
                    agent.AgentPricing.Pricing.length === 0) && (
                    <div className="text-sm text-muted-foreground">
                      No pricing information available
                    </div>
                  )}
                </div>
              </div>

              {/* Wallet Information */}
              <div>
                <h3 className="font-medium mb-2">Wallet Information</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Selling Wallet Address
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {shortenAddress(
                          agent.SmartContractWallet?.walletAddress || '',
                        )}
                      </span>
                      <CopyButton
                        value={agent.SmartContractWallet?.walletAddress || ''}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Selling Wallet Vkey
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {shortenAddress(
                          agent.SmartContractWallet?.walletVkey || '',
                        )}
                      </span>
                      <CopyButton
                        value={agent.SmartContractWallet?.walletVkey || ''}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div>
                <h3 className="font-medium mb-2">Additional Information</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Created
                    </span>
                    <span>{formatDate(agent.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Last Updated
                    </span>
                    <span>{formatDate(agent.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Agent ID
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {shortenAddress(agent.agentIdentifier || '')}
                      </span>
                      <CopyButton value={agent.agentIdentifier || ''} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">
                      Status
                    </span>
                    <Badge
                      variant={getStatusBadgeVariant(agent.state)}
                      className={cn(
                        agent.state === 'RegistrationConfirmed' &&
                          'bg-green-50 text-green-700 hover:bg-green-50/80',
                      )}
                    >
                      {parseAgentStatus(agent.state)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            {/* Actions Section */}
            <div className="pt-4 border-t flex justify-end gap-2 bg-background absolute bottom-0 left-0 w-full p-4 z-10">
              <Button
                onClick={() => setIsPurchaseDialogOpen(true)}
                disabled
                className="font-semibold"
              >
                Trigger Purchase
              </Button>
              <Button
                variant="destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <ConfirmDialog
              open={isDeleteDialogOpen}
              onClose={() => setIsDeleteDialogOpen(false)}
              title="Delete AI Agent"
              description={`Are you sure you want to delete "${agent?.name}"? This action cannot be undone.`}
              onConfirm={async () => {
                await handleDelete();
                setIsDeleteDialogOpen(false);
              }}
              isLoading={false}
            />
            <ConfirmDialog
              open={isPurchaseDialogOpen}
              onClose={() => setIsPurchaseDialogOpen(false)}
              title="Trigger Purchase"
              description={`Are you sure you want to trigger a purchase for "${agent?.name}"?`}
              onConfirm={async () => {
                // TODO: call postPurchase here
                setIsPurchaseDialogOpen(false);
              }}
              isLoading={false}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
