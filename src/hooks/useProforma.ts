import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { calculateDocumentTotals, type TaxableItem } from '@/utils/taxCalculation';
import { parseErrorMessage } from '@/utils/errorHelpers';

export interface ProformaItem {
  id?: string;
  proforma_id?: string;
  product_id: string;
  product_name?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  discount_amount?: number;
  tax_percentage: number;
  tax_amount: number;
  tax_inclusive: boolean;
  line_total: number;
}

export interface ProformaInvoice {
  id?: string;
  company_id: string;
  customer_id: string;
  proforma_number: string;
  proforma_date: string;
  valid_until: string;
  subtotal: number;
  tax_percentage?: number;
  tax_amount: number;
  total_amount: number;
  status: 'draft' | 'sent' | 'accepted' | 'expired' | 'converted';
  notes?: string;
  terms_and_conditions?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProformaWithItems extends ProformaInvoice {
  customers?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  proforma_items?: ProformaItem[];
}

/**
 * Hook to fetch proforma invoices for a company
 */
export const useProformas = (companyId?: string) => {
  return useQuery({
    queryKey: ['proforma_invoices', companyId],
    queryFn: async () => {
      if (!companyId) return [];

      const { data, error } = await supabase
        .from('proforma_invoices')
        .select(`
          *,
          customers (
            id,
            name,
            email,
            phone,
            address
          ),
          proforma_items (
            *,
            products (
              name
            )
          )
        `)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching proformas:', error);
        throw error;
      }

      // Map product names to items for compatibility
      const proformasWithProductNames = data?.map(proforma => ({
        ...proforma,
        proforma_items: proforma.proforma_items?.map(item => ({
          ...item,
          product_name: item.products?.name || ''
        }))
      }));

      return proformasWithProductNames as ProformaWithItems[];
    },
    enabled: !!companyId,
  });
};

/**
 * Hook to fetch a single proforma invoice
 */
export const useProforma = (proformaId?: string) => {
  return useQuery({
    queryKey: ['proforma_invoice', proformaId],
    queryFn: async () => {
      if (!proformaId) return null;

      const { data, error } = await supabase
        .from('proforma_invoices')
        .select(`
          *,
          customers (
            id,
            name,
            email,
            phone,
            address
          ),
          proforma_items (
            *,
            products (
              name
            )
          )
        `)
        .eq('id', proformaId)
        .single();

      if (error) {
        console.error('Error fetching proforma:', error);
        throw error;
      }

      // Map product names to items for compatibility
      const proformaWithProductNames = {
        ...data,
        proforma_items: data.proforma_items?.map(item => ({
          ...item,
          product_name: item.products?.name || ''
        }))
      };

      return proformaWithProductNames as ProformaWithItems;
    },
    enabled: !!proformaId,
  });
};

// Utility function to serialize errors properly
const serializeError = (error: any): string => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.details) return error.details;
  if (error.hint) return error.hint;
  if (error.code) return `Database error (code: ${error.code})`;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return parseErrorMessage(error);
  }
};

/**
 * Hook to create a proforma invoice with items
 */
export const useCreateProforma = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ proforma, items }: { proforma: ProformaInvoice; items: ProformaItem[] }) => {
      // Validate and calculate totals
      const taxableItems: TaxableItem[] = items.map(item => ({
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_percentage: item.tax_percentage,
        tax_inclusive: item.tax_inclusive,
        discount_percentage: item.discount_percentage,
        discount_amount: item.discount_amount,
      }));

      const totals = calculateDocumentTotals(taxableItems);

      // Update proforma with calculated totals
      const proformaWithTotals = {
        ...proforma,
        subtotal: totals.subtotal,
        tax_amount: totals.tax_total,
        total_amount: totals.total_amount,
      };

      // Ensure created_by defaults to authenticated user
      let cleanProforma = { ...proformaWithTotals } as any;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const authUserId = userData?.user?.id || null;
        if (authUserId) {
          cleanProforma.created_by = authUserId;
        } else if (typeof cleanProforma.created_by === 'undefined' || cleanProforma.created_by === null) {
          cleanProforma.created_by = null;
        }
      } catch {
        if (typeof cleanProforma.created_by === 'undefined') {
          cleanProforma.created_by = null;
        }
      }

      // Create the proforma invoice (retry without valid_until if column missing)
      let proformaData;
      let firstData; let proformaError: any;
      {
        const { data, error } = await supabase
          .from('proforma_invoices')
          .insert([cleanProforma])
          .select()
          .single();
        firstData = data; proformaError = error as any;
      }

      // Fallback: if FK violation on created_by, retry with created_by = null
      if (proformaError && proformaError.code === '23503' && String(proformaError.message || '').includes('created_by')) {
        const retryPayload = { ...cleanProforma, created_by: null };
        const retryRes = await supabase
          .from('proforma_invoices')
          .insert([retryPayload])
          .select()
          .single();
        firstData = retryRes.data; proformaError = retryRes.error as any;
      }

      if (proformaError) {
        const errorMessage = serializeError(proformaError).toLowerCase();
        console.warn('Proforma insert failed, checking for schema mismatch:', errorMessage);

        if (errorMessage.includes('valid_until')) {
          const { valid_until, ...withoutValidUntil } = cleanProforma as any;
          const retry = await supabase
            .from('proforma_invoices')
            .insert([withoutValidUntil])
            .select()
            .single();

          if (retry.error) {
            const retryMessage = serializeError(retry.error);
            console.error('Retry insert failed:', retryMessage);
            throw new Error(`Failed to create proforma: ${retryMessage}`);
          }

          proformaData = retry.data;
        } else {
          throw new Error(`Failed to create proforma: ${serializeError(proformaError)}`);
        }
      } else {
        proformaData = firstData;
      }

      // Create the proforma items
      if (items.length > 0) {
        const proformaItemsFull = items.map(item => ({
          proforma_id: proformaData.id,
          product_id: item.product_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage || 0,
          discount_amount: item.discount_amount || 0,
          tax_percentage: item.tax_percentage,
          tax_amount: item.tax_amount,
          tax_inclusive: item.tax_inclusive,
          line_total: item.line_total,
        }));

        let { error: itemsError } = await supabase
          .from('proforma_items')
          .insert(proformaItemsFull);

        if (itemsError) {
          const firstMsg = serializeError(itemsError).toLowerCase();
          console.warn('Proforma items insert failed, attempting reduced columns:', firstMsg);

          // Retry without discount_amount / tax fields
          let proformaItemsReduced = items.map((item, index) => ({
            proforma_id: proformaData.id,
            product_id: item.product_id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percentage: item.discount_percentage || 0,
            line_total: item.line_total,
            sort_order: index + 1,
          }));

          // If discount_percentage column is missing, remove it too
          if (firstMsg.includes('discount_percentage')) {
            proformaItemsReduced = proformaItemsReduced.map(({ discount_percentage, ...rest }) => rest as any);
          }

          const retry = await supabase
            .from('proforma_items')
            .insert(proformaItemsReduced);

          if (retry.error) {
            const retryMessage = serializeError(retry.error);
            console.error('Retry creating proforma items failed:', retryMessage);
            // Try to delete the proforma if items creation failed
            await supabase.from('proforma_invoices').delete().eq('id', proformaData.id);
            throw new Error(`Failed to create proforma items: ${retryMessage}`);
          }
        }
      }

      return proformaData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proforma_invoices'] });
      toast.success(`Proforma invoice ${data.proforma_number} created successfully!`);
    },
    onError: (error) => {
      const errorMessage = serializeError(error);
      console.error('Error creating proforma:', errorMessage);
      toast.error(`Error creating proforma: ${errorMessage}`);
    },
  });
};

/**
 * Hook to update a proforma invoice
 */
export const useUpdateProforma = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      proformaId, 
      proforma, 
      items 
    }: { 
      proformaId: string; 
      proforma: Partial<ProformaInvoice>; 
      items?: ProformaItem[] 
    }) => {
      // If items are provided, recalculate totals
      if (items) {
        const taxableItems: TaxableItem[] = items.map(item => ({
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_percentage: item.tax_percentage,
          tax_inclusive: item.tax_inclusive,
          discount_percentage: item.discount_percentage,
          discount_amount: item.discount_amount,
        }));

        const totals = calculateDocumentTotals(taxableItems);

        // Update proforma with calculated totals
        proforma = {
          ...proforma,
          subtotal: totals.subtotal,
          tax_amount: totals.tax_total,
          total_amount: totals.total_amount,
        };
      }

      // Update the proforma invoice
      const { data: proformaData, error: proformaError } = await supabase
        .from('proforma_invoices')
        .update(proforma)
        .eq('id', proformaId)
        .select()
        .single();

      if (proformaError) {
        const errorMessage = serializeError(proformaError);
        console.error('Error updating proforma:', errorMessage);
        throw new Error(`Failed to update proforma: ${errorMessage}`);
      }

      // Update items if provided
      if (items) {
        // Delete existing items
        const { error: deleteError } = await supabase
          .from('proforma_items')
          .delete()
          .eq('proforma_id', proformaId);

        if (deleteError) {
          const errorMessage = serializeError(deleteError);
          console.error('Error deleting existing proforma items:', errorMessage);
          throw new Error(`Failed to delete existing proforma items: ${errorMessage}`);
        }

        // Insert new items
        if (items.length > 0) {
          const proformaItems = items.map(item => ({
            proforma_id: proformaId,
            product_id: item.product_id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percentage: item.discount_percentage || 0,
            discount_amount: item.discount_amount || 0,
            tax_percentage: item.tax_percentage,
            tax_amount: item.tax_amount,
            tax_inclusive: item.tax_inclusive,
            line_total: item.line_total,
          }));

          const { error: itemsError } = await supabase
            .from('proforma_items')
            .insert(proformaItems);

          if (itemsError) {
            const errorMessage = serializeError(itemsError);
            console.error('Error creating updated proforma items:', errorMessage);
            throw new Error(`Failed to create updated proforma items: ${errorMessage}`);
          }
        }
      }

      return proformaData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proforma_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['proforma_invoice', data.id] });
      toast.success(`Proforma invoice ${data.proforma_number} updated successfully!`);
    },
    onError: (error) => {
      const errorMessage = serializeError(error);
      console.error('Error updating proforma:', errorMessage);
      toast.error(`Error updating proforma: ${errorMessage}`);
    },
  });
};

/**
 * Hook to delete a proforma invoice
 */
export const useDeleteProforma = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (proformaId: string) => {
      const { error } = await supabase
        .from('proforma_invoices')
        .delete()
        .eq('id', proformaId);

      if (error) {
        const errorMessage = serializeError(error);
        console.error('Error deleting proforma:', errorMessage);
        throw new Error(`Failed to delete proforma: ${errorMessage}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proforma_invoices'] });
      toast.success('Proforma invoice deleted successfully!');
    },
    onError: (error) => {
      const errorMessage = serializeError(error);
      console.error('Error deleting proforma:', errorMessage);
      toast.error(`Error deleting proforma: ${errorMessage}`);
    },
  });
};

/**
 * Hook to generate proforma number
 */
export const useGenerateProformaNumber = () => {
  return useMutation({
    mutationFn: async (companyId: string) => {
      try {
        const { data, error } = await supabase.rpc('generate_proforma_number', {
          company_uuid: companyId
        });

        if (error) {
          // Extract meaningful error message from Supabase error object
          let errorMessage = 'Unknown database error';

          if (typeof error === 'string') {
            errorMessage = error;
          } else if (error && typeof error === 'object') {
            // Handle different Supabase error formats
            if (error.message) {
              errorMessage = error.message;
            } else if (error.details) {
              errorMessage = error.details;
            } else if (error.hint) {
              errorMessage = error.hint;
            } else if (error.code) {
              errorMessage = `Database error (code: ${error.code})`;
            } else {
              // Try to get meaningful info from error object
              try {
                const errorKeys = Object.keys(error);
                if (errorKeys.length > 0) {
                  errorMessage = JSON.stringify(error, null, 2);
                }
              } catch {
                errorMessage = parseErrorMessage(error);
              }
            }
          }

          console.error('Error generating proforma number:', errorMessage);

          // Check if it's a function not found error
          if (errorMessage.includes('function generate_proforma_number') ||
              errorMessage.includes('does not exist') ||
              errorMessage.includes('is not defined') ||
              errorMessage.includes('cannot find') ||
              errorMessage.includes('schema cache')) {
            console.warn('generate_proforma_number function not found, using fallback');
            console.info('💡 To fix this permanently, visit: /proforma-function-fix');
            throw new Error('Database function not found. Visit /proforma-function-fix to create it.');
          }

          // Check for permission errors
          if (errorMessage.includes('permission denied') ||
              errorMessage.includes('access denied') ||
              errorMessage.includes('insufficient privilege')) {
            console.warn('Permission denied for proforma number generation, using fallback');
            throw new Error('Permission denied for database function. Using fallback number generation.');
          }

          throw new Error(`Failed to generate proforma number: ${errorMessage}`);
        }

        return data;
      } catch (error) {
        // Fallback to client-side generation
        const timestamp = Date.now().toString().slice(-6);
        const year = new Date().getFullYear();
        const fallbackNumber = `PF-${year}-${timestamp}`;

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn('Proforma number generation failed, using fallback:', errorMessage);
        console.info('Generated fallback number:', fallbackNumber);

        return fallbackNumber;
      }
    },
  });
};

/**
 * Hook to convert proforma to invoice
 */
export const useConvertProformaToInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (proformaId: string) => {
      // This would implement the conversion logic
      // For now, just mark the proforma as converted
      const { data, error } = await supabase
        .from('proforma_invoices')
        .update({ status: 'converted' })
        .eq('id', proformaId)
        .select()
        .single();

      if (error) {
        console.error('Error converting proforma to invoice:', error);
        throw error;
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proforma_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['proforma_invoice', data.id] });
      toast.success(`Proforma invoice ${data.proforma_number} converted to invoice!`);
    },
    onError: (error) => {
      const errorMessage = serializeError(error);
      console.error('Error converting proforma to invoice:', errorMessage);
      toast.error(`Error converting proforma: ${errorMessage}`);
    },
  });
};
