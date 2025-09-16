import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Plus, 
  Trash2, 
  Search,
  Calculator,
  Receipt,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';
import { useCustomers, useProducts, useTaxSettings } from '@/hooks/useDatabase';
import { useCreateProforma, useGenerateProformaNumber, type ProformaItem } from '@/hooks/useProforma';
import { calculateItemTax, calculateDocumentTotals, formatCurrency, type TaxableItem } from '@/utils/taxCalculation';
import { setupProformaTables, checkProformaTables } from '@/utils/proformaDatabaseSetup';
import { ProformaErrorNotification } from '@/components/fixes/ProformaErrorNotification';
import { autoFixProformaFunction } from '@/utils/immediateProformaFix';
import { toast } from 'sonner';

interface CreateProformaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  companyId?: string;
}

export const CreateProformaModalFixed = ({ 
  open, 
  onOpenChange, 
  onSuccess,
  companyId = '550e8400-e29b-41d4-a716-446655440000' 
}: CreateProformaModalProps) => {
  const [formData, setFormData] = useState({
    customer_id: '',
    proforma_date: new Date().toISOString().split('T')[0],
    valid_until: '',
    notes: '',
    terms_and_conditions: '',
  });

  const [items, setItems] = useState<ProformaItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [proformaNumber, setProformaNumber] = useState('');
  const [tablesStatus, setTablesStatus] = useState<'checking' | 'ready' | 'missing' | 'error'>('checking');
  const [functionError, setFunctionError] = useState<string>('');

  const { data: customers } = useCustomers(companyId);
  const { data: products } = useProducts(companyId);
  const { data: taxSettings } = useTaxSettings(companyId);
  const generateProformaNumber = useGenerateProformaNumber();
  const createProforma = useCreateProforma();

  const defaultTaxRate = taxSettings?.find(t => t.is_default)?.rate || 0;

  // Check database tables on mount
  useEffect(() => {
    if (open) {
      checkTables();
    }
  }, [open]);

  const checkTables = async () => {
    try {
      setTablesStatus('checking');
      const status = await checkProformaTables();
      
      if (status.ready) {
        setTablesStatus('ready');
      } else {
        setTablesStatus('missing');
      }
    } catch (error) {
      console.error('Error checking proforma tables:', error);
      setTablesStatus('error');
    }
  };

  const setupTables = async () => {
    try {
      toast.info('Setting up proforma tables...');
      const result = await setupProformaTables();
      
      if (result.success) {
        toast.success('Proforma tables created successfully!');
        setTablesStatus('ready');
      } else {
        toast.error(`Failed to create proforma tables: ${result.errors.join(', ')}`);
        setTablesStatus('error');
      }
    } catch (error) {
      console.error('Error setting up proforma tables:', error);
      toast.error('Failed to setup proforma tables');
      setTablesStatus('error');
    }
  };

  useEffect(() => {
    if (open && tablesStatus === 'ready') {
      // Generate proforma number with auto-fix
      generateProformaNumber.mutate(companyId, {
        onSuccess: (number) => {
          setProformaNumber(number);
          setFunctionError(''); // Clear any previous errors
          console.log('Proforma number generated successfully:', number);
        },
        onError: async (error) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.warn('Proforma number generation failed, attempting auto-fix:', errorMessage);

          // Check if this is a function not found error
          if (errorMessage.includes('generate_proforma_number') ||
              errorMessage.includes('schema cache') ||
              errorMessage.includes('function') ||
              errorMessage.includes('does not exist')) {

            console.log('🔧 Attempting automatic function fix...');
            toast.info('Database function missing. Attempting automatic fix...');

            try {
              // Try automatic fix
              const fixedNumber = await autoFixProformaFunction();
              setProformaNumber(fixedNumber);
              setFunctionError(''); // Clear error since we fixed it
              toast.success(`Function fixed! Generated number: ${fixedNumber}`);
              console.log('✅ Auto-fix successful, generated:', fixedNumber);
              return;
            } catch (fixError) {
              console.error('❌ Auto-fix failed:', fixError);
              // Fall through to manual error handling
            }
          }

          // Set error for notification (if auto-fix failed or different error)
          setFunctionError(errorMessage);

          const timestamp = Date.now().toString().slice(-6);
          const year = new Date().getFullYear();
          const fallbackNumber = `PF-${year}-${timestamp}`;
          setProformaNumber(fallbackNumber);

          console.info('Using fallback proforma number:', fallbackNumber);
          toast.warning(`Using fallback number: ${fallbackNumber}`);
        }
      });

      // Set default valid until date (30 days from today)
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      setFormData(prev => ({
        ...prev,
        valid_until: validUntil.toISOString().split('T')[0]
      }));
    }
  }, [open, tablesStatus, generateProformaNumber, companyId]);

  const filteredProducts = products?.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.product_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const addItem = (product: any) => {
    const newItem: ProformaItem = {
      id: `item-${Date.now()}`,
      product_id: product.id,
      product_name: product.name,
      description: product.description || '',
      quantity: 1,
      unit_price: product.selling_price,
      discount_percentage: 0,
      discount_amount: 0,
      tax_percentage: defaultTaxRate,
      tax_amount: 0,
      tax_inclusive: false,
      line_total: 0,
    };

    // Calculate tax and totals using the proper utility
    const calculatedItem = calculateItemTax(newItem);
    const updatedItem: ProformaItem = {
      ...newItem,
      tax_amount: calculatedItem.tax_amount,
      line_total: calculatedItem.line_total,
    };

    setItems(prev => [...prev, updatedItem]);
    setShowProductSearch(false);
    setSearchTerm('');
  };

  const updateItem = (id: string, field: keyof ProformaItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        let updatedItem = { ...item, [field]: value };

        // Special handling for tax_inclusive checkbox
        if (field === 'tax_inclusive') {
          if (value && item.tax_percentage === 0) {
            updatedItem.tax_percentage = defaultTaxRate;
          }
          if (!value) {
            updatedItem.tax_percentage = 0;
          }
        }

        // Recalculate using proper tax utility
        const calculatedItem = calculateItemTax(updatedItem);
        return {
          ...updatedItem,
          tax_amount: calculatedItem.tax_amount,
          line_total: calculatedItem.line_total,
        };
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const calculateTotals = () => {
    const taxableItems: TaxableItem[] = items.map(item => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_percentage: item.tax_percentage,
      tax_inclusive: item.tax_inclusive,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount,
    }));

    return calculateDocumentTotals(taxableItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customer_id) {
      toast.error('Please select a customer');
      return;
    }

    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    try {
      const totals = calculateTotals();

      const proformaData = {
        company_id: companyId,
        customer_id: formData.customer_id,
        proforma_number: proformaNumber,
        proforma_date: formData.proforma_date,
        valid_until: formData.valid_until,
        status: 'draft' as const,
        subtotal: totals.subtotal,
        tax_amount: totals.tax_total,
        total_amount: totals.total_amount,
        notes: formData.notes,
        terms_and_conditions: formData.terms_and_conditions,
      };

      await createProforma.mutateAsync({
        proforma: proformaData,
        items: items
      });

      onSuccess?.();
      handleClose();
    } catch (error) {
      console.error('Error creating proforma:', error);
      // Error handling is done in the hook
    }
  };

  const handleClose = () => {
    setFormData({
      customer_id: '',
      proforma_date: new Date().toISOString().split('T')[0],
      valid_until: '',
      notes: '',
      terms_and_conditions: '',
    });
    setItems([]);
    setSearchTerm('');
    setShowProductSearch(false);
    onOpenChange(false);
  };

  const totals = calculateTotals();

  // Render different content based on table status
  if (tablesStatus === 'checking') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Setting up Proforma Invoices</DialogTitle>
            <DialogDescription>
              Checking database configuration...
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (tablesStatus === 'missing' || tablesStatus === 'error') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Database Setup Required
            </DialogTitle>
            <DialogDescription>
              Proforma invoice tables need to be created in the database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-warning-light border border-warning/20 rounded-lg p-4">
              <p className="text-sm text-warning">
                The proforma invoices feature requires additional database tables. 
                Click the button below to set them up automatically.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={setupTables}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Setup Tables
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Create Proforma Invoice
          </DialogTitle>
          <DialogDescription>
            Create a new proforma invoice with proper tax calculation
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Notification */}
          {functionError && (
            <ProformaErrorNotification
              error={functionError}
              onDismiss={() => setFunctionError('')}
              onFixSuccess={(number) => {
                setProformaNumber(number);
                setFunctionError('');
                toast.success(`Proforma function fixed! Number: ${number}`);
              }}
            />
          )}

          {/* Header Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proforma_number">Proforma Number</Label>
              <Input
                id="proforma_number"
                value={proformaNumber}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer_id">Customer *</Label>
              <Select value={formData.customer_id} onValueChange={(value) => 
                setFormData(prev => ({ ...prev, customer_id: value }))
              }>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proforma_date">Proforma Date</Label>
              <Input
                id="proforma_date"
                type="date"
                value={formData.proforma_date}
                onChange={(e) => setFormData(prev => ({ ...prev, proforma_date: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="valid_until">Valid Until</Label>
              <Input
                id="valid_until"
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData(prev => ({ ...prev, valid_until: e.target.value }))}
              />
            </div>
          </div>

          {/* Items Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Items
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowProductSearch(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {showProductSearch && (
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle className="text-sm">Add Product</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                        <Input
                          placeholder="Search products..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-2">
                        {filteredProducts?.map((product) => (
                          <div
                            key={product.id}
                            className="flex items-center justify-between p-2 border rounded cursor-pointer hover:bg-muted/50"
                            onClick={() => addItem(product)}
                          >
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {product.product_code} • {formatCurrency(product.selling_price)}
                              </p>
                            </div>
                            <Button size="sm" variant="ghost">
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowProductSearch(false)}
                        className="w-full"
                      >
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No items added yet. Click "Add Item" to start.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Tax %</TableHead>
                      <TableHead>Tax Incl.</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(item.id!, 'description', e.target.value)}
                            placeholder="Description"
                            className="min-w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id!, 'quantity', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => updateItem(item.id!, 'unit_price', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.tax_percentage}
                            onChange={(e) => updateItem(item.id!, 'tax_percentage', parseFloat(e.target.value) || 0)}
                            min="0"
                            max="100"
                            step="0.01"
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            checked={item.tax_inclusive}
                            onCheckedChange={(checked) => updateItem(item.id!, 'tax_inclusive', checked)}
                          />
                        </TableCell>
                        <TableCell>{formatCurrency(item.line_total)}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Totals */}
              {items.length > 0 && (
                <div className="mt-6 space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax:</span>
                    <span>{formatCurrency(totals.tax_total)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-lg border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(totals.total_amount)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Additional Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Internal notes..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="terms_and_conditions">Terms & Conditions</Label>
              <Textarea
                id="terms_and_conditions"
                value={formData.terms_and_conditions}
                onChange={(e) => setFormData(prev => ({ ...prev, terms_and_conditions: e.target.value }))}
                placeholder="Terms and conditions..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!formData.customer_id || items.length === 0 || createProforma.isPending}
            >
              {createProforma.isPending ? 'Creating...' : 'Create Proforma'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
