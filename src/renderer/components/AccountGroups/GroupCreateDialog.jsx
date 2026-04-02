/**
 * GroupCreateDialog — modal for creating or editing an account group.
 *
 * Props:
 *   open              {boolean}                         Dialog visibility
 *   onOpenChange      {Function}                        Toggle dialog
 *   source            {'ga_listens'|'posts'}            Data source for the group
 *   availableAccounts {Array<{account_name, platform, key}>}
 *   editGroup         {{id, name, members}|null}        null = create mode
 *   onSave            {Function}                        Called with saved group
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/utils/apiClient';

const GroupCreateDialog = ({ open, onOpenChange, source, availableAccounts, editGroup, onSave }) => {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const sortedAccounts = useMemo(
    () => [...availableAccounts].sort((a, b) => (a.account_name || '').localeCompare(b.account_name || '', 'sv')),
    [availableAccounts]
  );

  const availableKeys = useMemo(
    () => new Set(availableAccounts.map(a => a.key)),
    [availableAccounts]
  );

  // Keys in editGroup.members that no longer exist in availableAccounts
  const staleMembers = useMemo(() => {
    if (!editGroup) return [];
    return editGroup.members.filter(m => !availableKeys.has(m));
  }, [editGroup, availableKeys]);

  // Initialise form whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editGroup) {
      setName(editGroup.name);
      setSelected(new Set(editGroup.members.filter(m => availableKeys.has(m))));
    } else {
      setName('Alla P4');
      setSelected(new Set(
        availableAccounts
          .filter(a => /^P4\s/i.test(a.account_name))
          .map(a => a.key)
      ));
    }
  }, [open, editGroup, availableAccounts, availableKeys]);

  const allChecked = sortedAccounts.length > 0 && sortedAccounts.every(a => selected.has(a.key));
  const someChecked = !allChecked && sortedAccounts.some(a => selected.has(a.key));

  const toggleAll = () => {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedAccounts.map(a => a.key)));
    }
  };

  const toggleAccount = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('Gruppnamn krävs.'); return; }
    if (selected.size === 0) { setError('Minst ett konto måste väljas.'); return; }

    setSaving(true);
    try {
      const memberKeys = [...selected];
      let saved;
      if (editGroup) {
        saved = await api.updateAccountGroup(editGroup.id, { name: name.trim(), members: memberKeys });
      } else {
        saved = await api.createAccountGroup(name.trim(), source, memberKeys);
      }
      onSave(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const title = editGroup ? 'Redigera kontogrupp' : 'Skapa kontogrupp';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name field */}
          <div>
            <Label htmlFor="group-name" className="text-sm font-medium mb-1 block">
              Gruppnamn
            </Label>
            <Input
              id="group-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ange gruppnamn..."
            />
          </div>

          {/* Account picker */}
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Välj konton ({selected.size} valda)
            </Label>

            {/* Select-all toggle */}
            <div className="flex items-center gap-2 mb-2 pb-2 border-b">
              <Checkbox
                id="select-all"
                checked={allChecked}
                onCheckedChange={toggleAll}
              />
              <Label htmlFor="select-all" className="text-sm cursor-pointer">
                {allChecked ? 'Avmarkera alla' : 'Markera alla'}
              </Label>
            </div>

            {/* Scrollable account list */}
            <div className="overflow-y-auto border rounded-md" style={{ maxHeight: '320px' }}>
              {sortedAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">Inga konton tillgängliga.</p>
              ) : (
                sortedAccounts.map(account => (
                  <div
                    key={account.key}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 border-b last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        id={`acc-${account.key}`}
                        checked={selected.has(account.key)}
                        onCheckedChange={() => toggleAccount(account.key)}
                      />
                      <Label
                        htmlFor={`acc-${account.key}`}
                        className="text-sm cursor-pointer truncate"
                      >
                        {account.account_name}
                      </Label>
                    </div>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-2 shrink-0">
                      {account.platform}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Stale members warning (edit mode only) */}
          {staleMembers.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center gap-2 mb-1 text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">Finns ej i aktuell data:</span>
              </div>
              <ul className="text-sm text-amber-600 pl-6 space-y-0.5">
                {staleMembers.map(m => (
                  <li key={m}>{m.replace(/::[^:]+$/, '')}</li>
                ))}
              </ul>
              <p className="text-xs text-amber-500 mt-1">Dessa konton tas bort när du sparar.</p>
            </div>
          )}

          {/* Inline error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || selected.size === 0}
          >
            {saving ? 'Sparar...' : 'Spara grupp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GroupCreateDialog;
