import { useState } from 'react';
import { AddInventoryItemModal } from '@/components/inventory/AddInventoryItemModal';
import { EditInventoryItemModal } from '@/components/inventory/EditInventoryItemModal';
import { ViewInventoryItemModal } from '@/components/inventory/ViewInventoryItemModal';
import { RestockItemModal } from '@/components/inventory/RestockItemModal';
import { StockAdjustmentModal } from '@/components/inventory/StockAdjustmentModal';
import { useProducts, useCompanies } from '@/hooks/useDatabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter,
  Eye,
  Edit,
  Package,
  AlertTriangle,
  TrendingUp,
  TrendingDown
} from 'lucide-react';

interface InventoryItem {
  id: string;
  product_code: string;
  name: string;
  category_id?: string;
  product_categories?: {
    name: string;
  } | null;
  stock_quantity: number;
  minimum_stock_level: number;
  selling_price: number;
  cost_price?: number;
  status?: 'in_stock' | 'low_stock' | 'out_of_stock';
  description?: string;
  unit_of_measure?: string;
}

// Helper function to determine stock status
const getStockStatus = (currentStock: number, minStock: number): 'in_stock' | 'low_stock' | 'out_of_stock' => {
  if (currentStock === 0) return 'out_of_stock';
  if (currentStock <= minStock) return 'low_stock';
  return 'in_stock';
};

// Helper function to format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

function getStatusColor(status: InventoryItem['status']) {
  switch (status) {
    case 'in_stock':
      return 'bg-success-light text-success border-success/20';
    case 'low_stock':
      return 'bg-warning-light text-warning border-warning/20';
    case 'out_of_stock':
      return 'bg-destructive-light text-destructive border-destructive/20';
    default:
      return 'bg-muted text-muted-foreground border-muted-foreground/20';
  }
}

export default function Inventory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showRestockModal, setShowRestockModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Fetch products from database
  const { data: companies } = useCompanies();
  const currentCompany = companies?.[0];
  const { data: products, isLoading: loadingProducts, error: productsError } = useProducts(currentCompany?.id);

  const handleAddItem = () => {
    setShowAddModal(true);
  };

  const handleStockAdjustment = (item?: InventoryItem) => {
    if (item) {
      setSelectedItem(item);
      setShowAdjustmentModal(true);
    } else {
      toast.info('Please select an item for stock adjustment');
    }
  };

  const handleViewItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowViewModal(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowEditModal(true);
  };

  const handleRestockItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowRestockModal(true);
  };

  const handleModalSuccess = () => {
    // Data will be automatically refreshed due to React Query invalidation
    toast.success('Operation completed successfully!');
  };

  const handleEditSuccess = () => {
    setShowEditModal(false);
    setSelectedItem(null);
    // Data will be automatically refreshed due to React Query invalidation
    toast.success('Item updated successfully!');
  };

  const handleAdjustmentSuccess = () => {
    setShowAdjustmentModal(false);
    setSelectedItem(null);
    // Data will be automatically refreshed due to React Query invalidation
    toast.success('Stock adjustment completed successfully!');
  };

  // Transform products data to inventory items
  const inventory: InventoryItem[] = products?.map(product => ({
    ...product,
    status: getStockStatus(product.stock_quantity || 0, product.minimum_stock_level || 0)
  })) || [];

  const filteredInventory = inventory.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.product_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.product_categories?.name && item.product_categories.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalValue = inventory.reduce((sum, item) => {
    return sum + ((item.stock_quantity || 0) * (item.selling_price || 0));
  }, 0);

  const lowStockItems = inventory.filter(item => item.status === 'low_stock').length;
  const outOfStockItems = inventory.filter(item => item.status === 'out_of_stock').length;

  // Handle loading and error states
  if (loadingProducts) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Inventory</h1>
            <p className="text-muted-foreground">Loading inventory items...</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Loading products...</p>
          </div>
        </div>
      </div>
    );
  }

  if (productsError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Inventory</h1>
            <p className="text-muted-foreground">Error loading inventory</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <p className="text-destructive">Failed to load products</p>
            <p className="text-muted-foreground text-sm">{productsError.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground">
            Manage stock levels and inventory items
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" onClick={handleStockAdjustment}>
            <Package className="h-4 w-4 mr-2" />
            Stock Adjustment
          </Button>
          <Button className="gradient-primary text-primary-foreground hover:opacity-90 shadow-card" size="lg" onClick={handleAddItem}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Items</p>
                <p className="text-2xl font-bold text-primary">{inventory.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-success" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold text-success">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold text-warning">{lowStockItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-bold text-destructive">{outOfStockItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search inventory..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline">
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Code</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Min Stock</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Total Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <div className="flex flex-col items-center space-y-2">
                      <Package className="h-12 w-12 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {searchTerm ? 'No products found matching your search.' : 'No products in inventory yet.'}
                      </p>
                      {!searchTerm && (
                        <Button onClick={handleAddItem} className="mt-2">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Your First Product
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInventory.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{item.product_code}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.product_categories?.name || '-'}</TableCell>
                    <TableCell className={`font-semibold ${(item.stock_quantity || 0) <= (item.minimum_stock_level || 0) ? 'text-warning' : 'text-foreground'}`}>
                      {item.stock_quantity || 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.minimum_stock_level || 0}</TableCell>
                    <TableCell>{formatCurrency(item.selling_price || 0)}</TableCell>
                    <TableCell className="font-semibold text-success">{formatCurrency((item.stock_quantity || 0) * (item.selling_price || 0))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getStatusColor(item.status || 'out_of_stock')}>
                        {(item.status || 'out_of_stock').replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewItem(item)}
                          title="View item details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditItem(item)}
                          title="Edit item"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {item.status === 'low_stock' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestockItem(item)}
                            className="bg-warning-light text-warning border-warning/20 hover:bg-warning hover:text-warning-foreground ml-2"
                          >
                            <Package className="h-4 w-4 mr-1" />
                            Restock
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Inventory Modals */}
      <AddInventoryItemModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onSuccess={handleModalSuccess}
      />

      {selectedItem && (
        <ViewInventoryItemModal
          open={showViewModal}
          onOpenChange={setShowViewModal}
          item={selectedItem}
          onEdit={() => {
            setShowViewModal(false);
            handleEditItem(selectedItem);
          }}
          onRestock={() => {
            setShowViewModal(false);
            setShowRestockModal(true);
          }}
        />
      )}

      {selectedItem && (
        <RestockItemModal
          open={showRestockModal}
          onOpenChange={setShowRestockModal}
          onSuccess={handleModalSuccess}
          item={selectedItem}
        />
      )}

      {selectedItem && (
        <EditInventoryItemModal
          open={showEditModal}
          onOpenChange={setShowEditModal}
          onSuccess={handleEditSuccess}
          item={selectedItem}
        />
      )}

      {selectedItem && (
        <StockAdjustmentModal
          open={showAdjustmentModal}
          onOpenChange={setShowAdjustmentModal}
          onSuccess={handleAdjustmentSuccess}
          item={selectedItem}
        />
      )}

    </div>
  );
}
