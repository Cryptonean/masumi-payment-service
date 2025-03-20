/* eslint-disable react-hooks/exhaustive-deps */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MainLayout } from "@/components/layout/MainLayout";
import { Plus, Copy, Search } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { AddPaymentSourceDialog } from "@/components/payment-sources/AddPaymentSourceDialog";
import Link from "next/link";
import { useAppContext } from "@/lib/contexts/AppContext";
import { getPaymentSource } from "@/lib/api/generated";
import { toast } from "react-toastify";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, shortenAddress } from "@/lib/utils";
import Head from "next/head";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";

interface Wallet {
  id: string;
  walletVkey: string;
  walletAddress: string;
  collectionAddress: string | null;
  note: string | null;
}

interface PaymentSource {
  id: string;
  smartContractAddress: string;
  network: 'Preprod' | 'Mainnet';
  paymentType: 'Web3CardanoV1';
  feeRatePermille: number;
  status: 'Active' | 'Inactive';
  createdAt: string;
  PurchasingWallets: Wallet[];
  SellingWallets: Wallet[];
}

interface APIPaymentSource {
  id: string;
  createdAt: string;
  updatedAt: string;
  network: 'Preprod' | 'Mainnet';
  smartContractAddress: string;
  paymentType: 'Web3CardanoV1';
  lastIdentifierChecked: string | null;
  lastCheckedAt: string | null;
  feeRatePermille: number;
  PurchasingWallets: Wallet[];
  SellingWallets: Wallet[];
}

export default function PaymentSourcesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [paymentSources, setPaymentSources] = useState<PaymentSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { apiClient } = useAppContext();
  const [activeTab, setActiveTab] = useState('All');
  const [filteredPaymentSources, setFilteredPaymentSources] = useState<PaymentSource[]>([]);

  const tabs = [
    { name: 'All', count: null },
    { name: 'Preprod', count: null },
    { name: 'Mainnet', count: null },
  ];

  const fetchPaymentSources = async () => {
    try {
      setIsLoading(true);
      const response = await getPaymentSource({
        client: apiClient
      });

      if (response.data?.data?.PaymentSources) {
        const sources: PaymentSource[] = response.data.data.PaymentSources.map((source: APIPaymentSource) => ({
          id: source.id,
          smartContractAddress: source.smartContractAddress,
          network: source.network,
          paymentType: source.paymentType,
          feeRatePermille: source.feeRatePermille,
          status: source.lastIdentifierChecked ? 'Active' : 'Inactive' as const,
          createdAt: source.createdAt,
          PurchasingWallets: source.PurchasingWallets || [],
          SellingWallets: source.SellingWallets || []
        }));
        setPaymentSources(sources);
      }
    } catch (error) {
      console.error('Error fetching payment sources:', error);
      toast.error('Failed to load payment sources');
    } finally {
      setIsLoading(false);
    }
  };

  const filterPaymentSources = useCallback(() => {
    let filtered = [...paymentSources];

    if (activeTab === 'Preprod') {
      filtered = filtered.filter(source => source.network === 'Preprod');
    } else if (activeTab === 'Mainnet') {
      filtered = filtered.filter(source => source.network === 'Mainnet');
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(source => {
        const matchAddress = source.smartContractAddress?.toLowerCase().includes(query) || false;
        const matchNetwork = source.network?.toLowerCase().includes(query) || false;
        const matchType = source.paymentType?.toLowerCase().includes(query) || false;

        return matchAddress || matchNetwork || matchType;
      });
    }

    setFilteredPaymentSources(filtered);
  }, [paymentSources, searchQuery, activeTab]);

  useEffect(() => {
    fetchPaymentSources();
  }, []);

  useEffect(() => {
    filterPaymentSources();
  }, [filterPaymentSources, searchQuery, activeTab]);

  const handleSelectSource = (id: string) => {
    setSelectedSources(prev => 
      prev.includes(id) 
        ? prev.filter(sourceId => sourceId !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (paymentSources.length === 0) {
      setSelectedSources([]);
      return;
    }

    if (selectedSources.length === paymentSources.length) {
      setSelectedSources([]);
    } else {
      setSelectedSources(paymentSources.map(source => source.id));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <MainLayout>
      <Head>
        <title>Payment Sources | Admin Interface</title>
      </Head>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Payment Sources</h1>
            <p className="text-sm text-muted-foreground">
              Manage your payment sources.{' '}
              <Link href="#" className="text-primary hover:underline">
                Learn more
              </Link>
            </p>
          </div>
          <Button 
            className="flex items-center gap-2 bg-black text-white hover:bg-black/90"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add payment source
          </Button>
        </div>

        <Tabs 
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search Payment Source"
              value={searchQuery}
              className="max-w-xs pl-10"
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="w-12 p-4">
                  <Checkbox 
                    checked={filteredPaymentSources.length > 0 && selectedSources.length === filteredPaymentSources.length}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 text-left text-sm font-medium">Contract address</th>
                <th className="p-4 text-left text-sm font-medium">ID</th>
                <th className="p-4 text-left text-sm font-medium">Network</th>
                <th className="p-4 text-left text-sm font-medium">Payment type</th>
                <th className="p-4 text-left text-sm font-medium">Fee rate</th>
                <th className="p-4 text-left text-sm font-medium">Status</th>
                <th className="p-4 text-left text-sm font-medium">Created at</th>
                <th className="p-4 text-left text-sm font-medium">Wallets</th>
                <th className="w-20 p-4"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9}>
                    <Spinner size={20} addContainer />
                  </td>
                </tr>
              ) : filteredPaymentSources.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8">
                    No payment sources found
                  </td>
                </tr>
              ) : (
                filteredPaymentSources.map((source) => (
                  <tr key={source.id} className="border-b last:border-b-0">
                    <td className="p-4">
                      <Checkbox
                        checked={selectedSources.includes(source.id)}
                        onCheckedChange={() => handleSelectSource(source.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px] flex items-center gap-2">
                        {shortenAddress(source.smartContractAddress)} <Copy className="w-4 h-4 cursor-pointer" onClick={() => copyToClipboard(source.smartContractAddress)} />
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">{source.id}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">{source.network}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">{source.paymentType}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">{source.feeRatePermille}%</div>
                    </td>
                    <td className="p-4">
                      <div>
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          source.status === 'Active'
                            ? "bg-primary text-primary-foreground"
                            : "bg-orange-50 dark:bg-[#f002] text-orange-600 dark:text-orange-400"
                        )}>
                          {source.status}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {new Date(source.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {source.PurchasingWallets.length} Buying,<br /> {source.SellingWallets.length} Selling
                      </div>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm">•••</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

        </div>
        <div className="text-sm text-muted-foreground">
          Total: {filteredPaymentSources.length}
        </div>
      </div>

      <AddPaymentSourceDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={fetchPaymentSources}
      />
    </MainLayout>
  );
} 