import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface QuotationItem {
  quotation_id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_setting_id?: string;
  tax_percentage?: number;
  tax_amount?: number;
  tax_inclusive?: boolean;
  line_total: number;
  sort_order?: number;
}

export interface InvoiceItem {
  invoice_id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  discount_before_vat?: number;
  tax_setting_id?: string;
  tax_percentage?: number;
  tax_amount?: number;
  tax_inclusive?: boolean;
  line_total: number;
  sort_order?: number;
}

// Calculate line item totals with tax
export const calculateLineItemTotal = (item: {
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  tax_inclusive?: boolean;
}) => {
  const { quantity, unit_price, discount_percentage = 0, tax_percentage = 0, tax_inclusive = false } = item;
  
  const baseAmount = quantity * unit_price;
  const discountAmount = baseAmount * (discount_percentage / 100);
  const afterDiscount = baseAmount - discountAmount;
  
  let taxAmount = 0;
  let lineTotal = 0;
  
  if (tax_inclusive) {
    // Tax is already included in the unit price
    lineTotal = afterDiscount;
    taxAmount = afterDiscount - (afterDiscount / (1 + tax_percentage / 100));
  } else {
    // Tax is added on top
    taxAmount = afterDiscount * (tax_percentage / 100);
    lineTotal = afterDiscount + taxAmount;
  }
  
  return {
    line_total: lineTotal,
    tax_amount: taxAmount,
    subtotal: afterDiscount,
    discount_amount: discountAmount
  };
};

// Hook for restocking inventory
export const useRestockProduct = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      productId, 
      quantity, 
      costPerUnit, 
      companyId, 
      supplier, 
      notes 
    }: {
      productId: string;
      quantity: number;
      costPerUnit?: number;
      companyId: string;
      supplier?: string;
      notes?: string;
    }) => {
      // Create stock movement record
      const { data: movement, error: movementError } = await supabase
        .from('stock_movements')
        .insert([{
          company_id: companyId,
          product_id: productId,
          movement_type: 'IN',
          reference_type: 'RESTOCK',
          quantity: quantity,
          cost_per_unit: costPerUnit,
          notes: notes || `Restock from ${supplier || 'supplier'}`
        }])
        .select()
        .single();
      
      if (movementError) throw movementError;
      
      // Update product stock quantity
      const { error: stockError } = await supabase.rpc('update_product_stock', {
        product_uuid: productId,
        movement_type: 'IN',
        quantity: quantity
      });
      
      if (stockError) throw stockError;
      
      return movement;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] });
    },
  });
};

export const useCreateQuotationWithItems = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ quotation, items }: { quotation: any; items: QuotationItem[] }) => {
      // Ensure created_by references the authenticated user to satisfy FK constraints
      let cleanQuotation = { ...quotation } as any;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const authUserId = userData?.user?.id || null;
        if (authUserId) {
          cleanQuotation.created_by = authUserId;
        } else if (typeof cleanQuotation.created_by === 'undefined') {
          cleanQuotation.created_by = null;
        }
      } catch {
        if (typeof cleanQuotation.created_by === 'undefined') {
          cleanQuotation.created_by = null;
        }
      }

      // First create the quotation
      let quotationDataRes;
      let quotationErrorRes;
      {
        const { data, error } = await supabase
          .from('quotations')
          .insert([cleanQuotation])
          .select()
          .single();
        quotationDataRes = data; quotationErrorRes = error as any;
      }

      // Fallback: if FK violation on created_by, retry with created_by = null
      if (quotationErrorRes && quotationErrorRes.code === '23503' && String(quotationErrorRes.message || '').includes('created_by')) {
        const retryPayload = { ...cleanQuotation, created_by: null };
        const { data: retryData, error: retryError } = await supabase
          .from('quotations')
          .insert([retryPayload])
          .select()
          .single();
        quotationDataRes = retryData; quotationErrorRes = retryError as any;
      }

      if (quotationErrorRes) throw quotationErrorRes;
      const quotationData = quotationDataRes;

      // Then create the quotation items if any
      if (items.length > 0) {
        const quotationItems = items.map((item, index) => ({
          ...item,
          quotation_id: quotationData.id,
          sort_order: index + 1
        }));
        
        const { error: itemsError } = await supabase
          .from('quotation_items')
          .insert(quotationItems);
        
        if (itemsError) throw itemsError;
      }
      
      return quotationData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
    },
  });
};

// Convert quotation to invoice
export const useConvertQuotationToInvoice = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (quotationId: string) => {
      // Get quotation data
      const { data: quotation, error: quotationError } = await supabase
        .from('quotations')
        .select(`
          *,
          quotation_items(*)
        `)
        .eq('id', quotationId)
        .single();
      
      if (quotationError) throw quotationError;
      
      // Generate invoice number
      const { data: invoiceNumber } = await supabase.rpc('generate_invoice_number', {
        company_uuid: quotation.company_id
      });
      
      // Create invoice from quotation
      // Determine creator
      let createdBy: string | null = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        createdBy = userData?.user?.id || null;
      } catch {
        createdBy = null;
      }

      const invoiceData = {
        company_id: quotation.company_id,
        customer_id: quotation.customer_id,
        invoice_number: invoiceNumber,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'sent',
        subtotal: quotation.subtotal,
        tax_amount: quotation.tax_amount,
        total_amount: quotation.total_amount,
        notes: quotation.notes,
        terms_and_conditions: quotation.terms_and_conditions,
        affects_inventory: true,
        created_by: createdBy
      };

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert([invoiceData])
        .select()
        .single();
      
      if (invoiceError) throw invoiceError;
      
      // Create invoice items from quotation items
      if (quotation.quotation_items && quotation.quotation_items.length > 0) {
        const invoiceItems = quotation.quotation_items.map((item: any) => ({
          invoice_id: invoice.id,
          product_id: item.product_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage,
          discount_before_vat: item.discount_before_vat || 0,
          tax_setting_id: item.tax_setting_id,
          tax_percentage: item.tax_percentage,
          tax_amount: item.tax_amount,
          tax_inclusive: item.tax_inclusive,
          line_total: item.line_total,
          sort_order: item.sort_order
        }));
        
        let itemsError: any = null;
        {
          const res = await supabase
            .from('invoice_items')
            .insert(invoiceItems);
          itemsError = res.error as any;
        }

        // Fallback: remove discount_before_vat if schema doesn't have it
        if (itemsError && (itemsError.code === 'PGRST204' || String(itemsError.message || '').toLowerCase().includes('discount_before_vat'))) {
          const minimalItems = invoiceItems.map(({ discount_before_vat, ...rest }) => rest);
          const retry = await supabase
            .from('invoice_items')
            .insert(minimalItems);
          itemsError = retry.error as any;
        }

        if (itemsError) throw itemsError;
        
        // Create stock movements
        const stockMovements = invoiceItems
          .filter(item => item.product_id && item.quantity > 0)
          .map(item => ({
            company_id: invoice.company_id,
            product_id: item.product_id,
            movement_type: 'OUT' as const,
            reference_type: 'INVOICE' as const,
            reference_id: invoice.id,
            quantity: -item.quantity,
            cost_per_unit: item.unit_price,
            notes: `Stock reduction for invoice ${invoice.invoice_number} (converted from quotation ${quotation.quotation_number})`
          }));

        if (stockMovements.length > 0) {
          await supabase.from('stock_movements').insert(stockMovements);

          // Update product stock quantities in parallel
          const stockUpdatePromises = stockMovements.map(movement =>
            supabase.rpc('update_product_stock', {
              product_uuid: movement.product_id,
              movement_type: movement.movement_type,
              quantity: Math.abs(movement.quantity)
            })
          );

          const stockUpdateResults = await Promise.allSettled(stockUpdatePromises);

          // Log any failed stock updates
          stockUpdateResults.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error('Failed to update stock for product:', stockMovements[index].product_id, result.reason);
            } else if (result.value.error) {
              console.error('Stock update error for product:', stockMovements[index].product_id, result.value.error);
            }
          });
        }
      }
      
      // Update quotation status
      await supabase
        .from('quotations')
        .update({ status: 'converted' })
        .eq('id', quotationId);
      
      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] });
    },
  });
};

export const useCreateInvoiceWithItems = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoice, items }: { invoice: any; items: InvoiceItem[] }) => {
      // Ensure created_by references the authenticated user to satisfy FK constraints
      let cleanInvoice = { ...invoice } as any;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const authUserId = userData?.user?.id || null;
        if (authUserId) {
          cleanInvoice.created_by = authUserId;
        } else if (typeof cleanInvoice.created_by === 'undefined') {
          // Leave as null if no auth user available; FK allows null
          cleanInvoice.created_by = null;
        }
      } catch {
        // If auth lookup fails, don't block invoice creation
        if (typeof cleanInvoice.created_by === 'undefined') {
          cleanInvoice.created_by = null;
        }
      }

      // First create the invoice
      let invoiceDataRes;
      let invoiceErrorRes;
      {
        const { data, error } = await supabase
          .from('invoices')
          .insert([cleanInvoice])
          .select()
          .single();
        invoiceDataRes = data; invoiceErrorRes = error as any;
      }
      if (invoiceErrorRes && invoiceErrorRes.code === '23503' && String(invoiceErrorRes.message || '').includes('created_by')) {
        const retryPayload = { ...cleanInvoice, created_by: null };
        const { data: retryData, error: retryError } = await supabase
          .from('invoices')
          .insert([retryPayload])
          .select()
          .single();
        invoiceDataRes = retryData; invoiceErrorRes = retryError as any;
      }

      if (invoiceErrorRes) throw invoiceErrorRes;
      const invoiceData = invoiceDataRes;

      // Then create the invoice items if any
      if (items.length > 0) {
        const invoiceItems = items.map((item, index) => ({
          ...item,
          invoice_id: invoiceData.id,
          sort_order: index + 1
        }));

        let itemsError: any = null;
        {
          const res = await supabase
            .from('invoice_items')
            .insert(invoiceItems);
          itemsError = res.error as any;
        }

        // Fallback: remove discount_before_vat if schema doesn't have it
        if (itemsError && (itemsError.code === 'PGRST204' || String(itemsError.message || '').toLowerCase().includes('discount_before_vat'))) {
          const minimalItems = invoiceItems.map(({ discount_before_vat, ...rest }) => rest);
          const retry = await supabase
            .from('invoice_items')
            .insert(minimalItems);
          itemsError = retry.error as any;
        }

        if (itemsError) throw itemsError;

        // Create stock movements for products that affect inventory
        if (invoice.affects_inventory !== false) {
          const stockMovements = items
            .filter(item => item.product_id && item.quantity > 0)
            .map(item => ({
              company_id: invoice.company_id,
              product_id: item.product_id!,
              movement_type: 'OUT' as const,
              reference_type: 'INVOICE' as const,
              reference_id: invoiceData.id,
              quantity: item.quantity, // Positive quantity, movement_type determines direction
              cost_per_unit: item.unit_price,
              notes: `Stock reduction for invoice ${invoice.invoice_number}`
            }));

          if (stockMovements.length > 0) {
            // Use the robust stock movements creation utility
            const { createStockMovements } = await import('@/utils/initializeStockMovements');
            const { data: stockData, error: stockError } = await createStockMovements(stockMovements);

            if (stockError) {
              console.error('Failed to create stock movements:', stockError);

              // Check if this is a constraint violation error
              if (stockError.message && stockError.message.includes('check constraint violation')) {
                console.error('Stock movements constraint error detected. The database constraints may need to be fixed.');
                throw new Error('Invoice creation failed due to stock movements constraint error. Please contact your system administrator to fix the database constraints.');
              }

              // Don't throw for other errors - invoice was created successfully, stock inconsistency can be fixed later
              console.warn(`Stock movements creation failed for invoice ${invoice.invoice_number}. Invoice created successfully but inventory may not be updated.`);
            } else {
              console.log(`Created ${stockData?.length || 0} stock movements for invoice ${invoice.invoice_number}`);
            }

            // Update product stock quantities in parallel for better performance
            const stockUpdatePromises = stockMovements.map(movement =>
              supabase.rpc('update_product_stock', {
                product_uuid: movement.product_id,
                movement_type: movement.movement_type,
                quantity: Math.abs(movement.quantity) // Use absolute value since movement_type determines direction
              })
            );

            const stockUpdateResults = await Promise.allSettled(stockUpdatePromises);

            // Check for any failed stock updates
            const failedUpdates = stockUpdateResults.filter((result, index) => {
              if (result.status === 'rejected') {
                console.error('Failed to update stock for product:', stockMovements[index].product_id, result.reason);
                return true;
              }
              if (result.status === 'fulfilled' && result.value.error) {
                console.error('Stock update error for product:', stockMovements[index].product_id, result.value.error);
                return true;
              }
              return false;
            });

            if (failedUpdates.length > 0) {
              console.warn(`${failedUpdates.length} out of ${stockMovements.length} stock updates failed`);
              // Don't throw - invoice was created successfully, stock inconsistencies can be fixed later
            }
          }
        }
      }

      return invoiceData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] });
    },
  });
};

export const useUpdateInvoiceWithItems = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoiceId, invoice, items }: { invoiceId: string; invoice: any; items: InvoiceItem[] }) => {
      // First, reverse any existing stock movements for this invoice
      const { data: existingMovements } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('reference_id', invoiceId)
        .eq('reference_type', 'INVOICE');

      if (existingMovements && existingMovements.length > 0) {
        // Create reverse movements
        const reverseMovements = existingMovements.map(movement => ({
          company_id: movement.company_id,
          product_id: movement.product_id,
          movement_type: movement.movement_type === 'OUT' ? 'IN' : 'OUT' as const,
          reference_type: 'ADJUSTMENT' as const,
          reference_id: invoiceId,
          quantity: -movement.quantity,
          notes: `Reversal for updated invoice ${invoice.invoice_number}`
        }));

        await supabase.from('stock_movements').insert(reverseMovements);

        // Update product stock quantities in parallel for reverse movements
        const reverseUpdatePromises = reverseMovements.map(movement =>
          supabase.rpc('update_product_stock', {
            product_uuid: movement.product_id,
            movement_type: movement.movement_type,
            quantity: Math.abs(movement.quantity)
          })
        );

        const reverseUpdateResults = await Promise.allSettled(reverseUpdatePromises);

        // Log any failed reverse stock updates
        reverseUpdateResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error('Failed to reverse stock for product:', reverseMovements[index].product_id, result.reason);
          } else if (result.value.error) {
            console.error('Reverse stock update error for product:', reverseMovements[index].product_id, result.value.error);
          }
        });
      }

      // Update the invoice
      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .update(invoice)
        .eq('id', invoiceId)
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Delete existing invoice items
      const { error: deleteError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', invoiceId);

      if (deleteError) throw deleteError;

      // Create new invoice items
      if (items.length > 0) {
        const invoiceItems = items.map((item, index) => ({
          ...item,
          invoice_id: invoiceId,
          sort_order: index + 1
        }));

        let itemsError: any = null;
        {
          const res = await supabase
            .from('invoice_items')
            .insert(invoiceItems);
          itemsError = res.error as any;
        }

        // Fallback: remove discount_before_vat if schema doesn't have it
        if (itemsError && (itemsError.code === 'PGRST204' || String(itemsError.message || '').toLowerCase().includes('discount_before_vat'))) {
          const minimalItems = invoiceItems.map(({ discount_before_vat, ...rest }) => rest);
          const retry = await supabase
            .from('invoice_items')
            .insert(minimalItems);
          itemsError = retry.error as any;
        }

        if (itemsError) throw itemsError;

        // Create new stock movements if affects inventory
        if (invoice.affects_inventory !== false) {
          const stockMovements = items
            .filter(item => item.product_id && item.quantity > 0)
            .map(item => ({
              company_id: invoice.company_id,
              product_id: item.product_id!,
              movement_type: 'OUT' as const,
              reference_type: 'INVOICE' as const,
              reference_id: invoiceId,
              quantity: -item.quantity,
              cost_per_unit: item.unit_price,
              notes: `Stock reduction for updated invoice ${invoice.invoice_number}`
            }));

          if (stockMovements.length > 0) {
            await supabase.from('stock_movements').insert(stockMovements);

            // Update product stock quantities in parallel for new movements
            const newStockUpdatePromises = stockMovements.map(movement =>
              supabase.rpc('update_product_stock', {
                product_uuid: movement.product_id,
                movement_type: movement.movement_type,
                quantity: Math.abs(movement.quantity)
              })
            );

            const newStockUpdateResults = await Promise.allSettled(newStockUpdatePromises);

            // Log any failed new stock updates
            newStockUpdateResults.forEach((result, index) => {
              if (result.status === 'rejected') {
                console.error('Failed to update stock for product:', stockMovements[index].product_id, result.reason);
              } else if (result.value.error) {
                console.error('Stock update error for product:', stockMovements[index].product_id, result.value.error);
              }
            });
          }
        }
      }

      return invoiceData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] });
    },
  });
};

// Create proforma invoice
export const useCreateProformaWithItems = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ proforma, items }: { proforma: any; items: any[] }) => {
      // Ensure created_by defaults to the authenticated user
      let cleanProforma = { ...proforma } as any;
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

      // First create the proforma invoice
      let proformaDataRes;
      let proformaErrorRes;
      {
        const { data, error } = await supabase
          .from('proforma_invoices')
          .insert([cleanProforma])
          .select()
          .single();
        proformaDataRes = data; proformaErrorRes = error as any;
      }
      if (proformaErrorRes && proformaErrorRes.code === '23503' && String(proformaErrorRes.message || '').includes('created_by')) {
        const retryPayload = { ...cleanProforma, created_by: null };
        const { data: retryData, error: retryError } = await supabase
          .from('proforma_invoices')
          .insert([retryPayload])
          .select()
          .single();
        proformaDataRes = retryData; proformaErrorRes = retryError as any;
      }

      if (proformaErrorRes) throw proformaErrorRes;
      const proformaData = proformaDataRes;

      // Then create the proforma items if any
      if (items.length > 0) {
        const proformaItems = items.map((item, index) => ({
          proforma_id: proformaData.id,
          product_id: item.product_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage || 0,
          discount_amount: item.discount_amount || 0,
          tax_percentage: item.tax_percentage || 0,
          tax_amount: item.tax_amount || 0,
          tax_inclusive: !!item.tax_inclusive,
          line_total: item.line_total,
          sort_order: index + 1
        }));

        let { error: itemsError } = await supabase
          .from('proforma_items')
          .insert(proformaItems);

        if (itemsError) {
          const msg = (itemsError.message || JSON.stringify(itemsError)).toLowerCase();
          if (msg.includes('discount_percentage')) {
            const minimalItems = proformaItems.map(({ discount_percentage, ...rest }) => rest);
            const retry = await supabase.from('proforma_items').insert(minimalItems);
            if (retry.error) throw retry.error;
          } else {
            throw itemsError;
          }
        }
      }

      return proformaData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proforma_invoices'] });
    },
  });
};

// Create delivery note (affects inventory without creating invoice)
export const useCreateDeliveryNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ deliveryNote, items }: { deliveryNote: any; items: any[] }) => {
      // Validate that delivery note is backed by a sale (invoice)
      if (!deliveryNote.invoice_id) {
        throw new Error('Delivery note must be linked to an existing invoice or sale.');
      }

      // Verify the invoice exists and belongs to the same company
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, customer_id, company_id')
        .eq('id', deliveryNote.invoice_id)
        .eq('company_id', deliveryNote.company_id)
        .single();

      if (invoiceError || !invoice) {
        throw new Error('Related invoice not found or does not belong to this company.');
      }

      // Verify customer matches
      if (invoice.customer_id !== deliveryNote.customer_id) {
        throw new Error('Delivery note customer must match the invoice customer.');
      }

      // Verify delivery items correspond to invoice items
      if (items.length > 0) {
        const { data: invoiceItems } = await supabase
          .from('invoice_items')
          .select('product_id, quantity')
          .eq('invoice_id', deliveryNote.invoice_id);

        const invoiceProductMap = new Map();
        (invoiceItems || []).forEach((item: any) => {
          invoiceProductMap.set(item.product_id, item.quantity);
        });

        // Check that all delivery items exist in the invoice
        for (const item of items) {
          if (!invoiceProductMap.has(item.product_id)) {
            throw new Error(`Product in delivery note is not included in the related invoice.`);
          }

          const invoiceQuantity = invoiceProductMap.get(item.product_id);
          const deliveredQuantity = item.quantity_delivered ?? item.quantity ?? 0;
          const orderedQuantity = item.quantity_ordered ?? invoiceQuantity ?? item.quantity ?? 0;

          if (deliveredQuantity > invoiceQuantity) {
            throw new Error(`Delivery quantity (${deliveredQuantity}) cannot exceed invoice quantity (${invoiceQuantity}) for product.`);
          }

          if (deliveredQuantity > orderedQuantity) {
            console.warn(`Delivery quantity (${deliveredQuantity}) exceeds ordered quantity (${orderedQuantity}) for product ${item.product_id}`);
          }
        }
      }

      // Create delivery note
      const { data: deliveryData, error: deliveryError } = await supabase
        .from('delivery_notes')
        .insert([deliveryNote])
        .select()
        .single();
      
      if (deliveryError) throw deliveryError;
      
      // Create delivery note items
      if (items.length > 0) {
        const deliveryItems = items.map((item, index) => {
          const quantityOrdered = item.quantity_ordered ?? item.quantity ?? item.quantity_delivered ?? 0;
          const quantityDelivered = item.quantity_delivered ?? item.quantity ?? 0;
          return {
            delivery_note_id: deliveryData.id,
            product_id: item.product_id,
            description: item.description,
            quantity_ordered: quantityOrdered,
            quantity_delivered: quantityDelivered,
            unit_of_measure: item.unit_of_measure ?? 'pcs',
            unit_price: item.unit_price ?? 0,
            sort_order: index + 1,
          };
        });

        const { error: itemsError } = await supabase
          .from('delivery_note_items')
          .insert(deliveryItems);

        if (itemsError) throw itemsError;

        // Create stock movements for delivered items
        const stockMovements = deliveryItems
          .filter(item => item.product_id && (item.quantity_delivered ?? 0) > 0)
          .map(item => ({
            company_id: deliveryNote.company_id,
            product_id: item.product_id,
            movement_type: 'OUT' as const,
            reference_type: 'DELIVERY_NOTE' as const,
            reference_id: deliveryData.id,
            quantity: -(item.quantity_delivered ?? 0),
            notes: `Stock delivery for delivery note ${deliveryNote.delivery_number || deliveryNote.delivery_note_number}`
          }));

        if (stockMovements.length > 0) {
          await supabase.from('stock_movements').insert(stockMovements);

          // Update product stock quantities
          for (const movement of stockMovements) {
            await supabase.rpc('update_product_stock', {
              product_uuid: movement.product_id,
              movement_type: movement.movement_type,
              quantity: Math.abs(movement.quantity)
            });
          }
        }
      }
      
      return deliveryData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery_notes'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] });
    },
  });
};
