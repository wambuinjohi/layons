import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, Plus } from 'lucide-react';
import { useUnits, useCreateUnit, useUpdateUnit, useDeleteUnit } from '@/hooks/useDatabase';
import { useCurrentCompany } from '@/contexts/CompanyContext';
import { CreateUnitModal } from '@/components/units/CreateUnitModal';
import { toast } from 'sonner';

export default function UnitsSettings() {
  const { currentCompany } = useCurrentCompany();
  const { data: units = [], isLoading } = useUnits(currentCompany?.id);
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const deleteUnit = useDeleteUnit();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const handleEdit = (u: any) => setEditing(u);
  const handleDelete = async (id: string) => {
    if (!confirm('Delete unit?')) return;
    try {
      await deleteUnit.mutateAsync(id);
      toast.success('Unit deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete unit');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Units</h1>
          <p className="text-muted-foreground">Manage measurement units used in BOQs</p>
        </div>
        <div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Unit
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Abbreviation</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3}>Loading...</TableCell></TableRow>
              ) : units.length === 0 ? (
                <TableRow><TableCell colSpan={3}>No units found</TableCell></TableRow>
              ) : units.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.abbreviation || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="ghost" onClick={() => handleEdit(u)} title="Edit"><Edit className="h-4 w-4" /></Button>
                      <Button size="icon" variant="destructive" onClick={() => handleDelete(u.id)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateUnitModal open={open} onOpenChange={setOpen} onCreated={(unit) => { setOpen(false); toast.success('Unit created'); }} />

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold">Edit Unit</h3>
            <div className="space-y-3 mt-4">
              <label className="block text-sm font-medium">Name</label>
              <input className="w-full border p-2" defaultValue={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <label className="block text-sm font-medium">Abbreviation</label>
              <input className="w-full border p-2" defaultValue={editing.abbreviation} onChange={(e) => setEditing({ ...editing, abbreviation: e.target.value })} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={async () => {
                try {
                  await updateUnit.mutateAsync({ id: editing.id, updates: { name: editing.name, abbreviation: editing.abbreviation } });
                  toast.success('Unit updated');
                  setEditing(null);
                } catch (err) { console.error(err); toast.error('Failed to update unit'); }
              }}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
