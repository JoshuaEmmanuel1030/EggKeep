import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, ShieldOff, Users, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface UserWithRole {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export function UserManagement() {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const { isAdmin } = useUserRole();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    email: string;
    action: 'promote' | 'demote' | 'delete';
  } | null>(null);

  const fetchUsers = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('admin-users', {
        method: 'GET',
      });

      if (response.error) throw response.error;
      
      setUsers(response.data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const handlePromote = async (userId: string) => {
    setActionLoading(userId);
    try {
      const { error } = await supabase
        .from('user_roles')
        .insert({
          user_id: userId,
          role: 'admin',
          granted_by: currentUser?.id,
        });

      if (error) throw error;

      toast.success(t.admin?.promoteSuccess || 'User promoted to admin');
      await fetchUsers();
    } catch (error: any) {
      console.error("Error promoting user:", error);
      toast.error(error.message || t.common.error);
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleDemote = async (userId: string) => {
    setActionLoading(userId);
    try {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) throw error;

      toast.success(t.admin?.demoteSuccess || 'Admin role removed');
      await fetchUsers();
    } catch (error: any) {
      console.error("Error demoting user:", error);
      toast.error(error.message || t.common.error);
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleDelete = async (userId: string) => {
    setActionLoading(userId);
    try {
      const response = await supabase.functions.invoke('admin-users', {
        body: { action: 'delete', userId },
      });

      if (response.error) throw response.error;

      toast.success(t.admin?.deleteSuccess || 'User account deleted');
      await fetchUsers();
    } catch (error: any) {
      console.error("Error deleting user:", error);
      toast.error(error.message || t.common.error);
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const confirmAction = () => {
    if (!confirmDialog) return;
    if (confirmDialog.action === 'promote') {
      handlePromote(confirmDialog.userId);
    } else if (confirmDialog.action === 'demote') {
      handleDemote(confirmDialog.userId);
    } else if (confirmDialog.action === 'delete') {
      handleDelete(confirmDialog.userId);
    }
  };

  const getDialogContent = () => {
    if (!confirmDialog) return { title: '', description: '' };
    
    switch (confirmDialog.action) {
      case 'promote':
        return {
          title: t.admin?.promoteTitle || 'Promote to Admin',
          description: t.admin?.promoteWarning || `Are you sure you want to give admin access to ${confirmDialog.email}? They will have full control over the catalog and user management.`,
        };
      case 'demote':
        return {
          title: t.admin?.demoteTitle || 'Remove Admin Role',
          description: t.admin?.demoteWarning || `Are you sure you want to remove admin access from ${confirmDialog.email}?`,
        };
      case 'delete':
        return {
          title: t.admin?.deleteTitle || 'Delete User Account',
          description: t.admin?.deleteWarning || `Are you sure you want to permanently delete the account for ${confirmDialog.email}? This action cannot be undone.`,
        };
      default:
        return { title: '', description: '' };
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t.admin?.noPermission || 'You do not have permission to view this page'}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dialogContent = getDialogContent();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          {t.admin?.userManagement || 'User Management'}
        </h2>
        <p className="text-muted-foreground">
          {t.admin?.manageUsersDesc || 'Manage user roles and permissions'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t.admin?.users || 'Users'} ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.auth.email}</TableHead>
                <TableHead>{t.admin?.role || 'Role'}</TableHead>
                <TableHead className="text-right">{t.catalog.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    {t.admin?.noUsers || 'No users found'}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      {user.role === 'admin' ? (
                        <Badge className="gap-1">
                          <Shield className="h-3 w-3" />
                          {t.admin?.adminBadge || 'Admin'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {t.admin?.userBadge || 'User'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.id === currentUser?.id ? (
                        <span className="text-xs text-muted-foreground">
                          {t.admin?.currentUser || '(You)'}
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          {user.role === 'admin' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              disabled={actionLoading === user.id}
                              onClick={() => setConfirmDialog({
                                open: true,
                                userId: user.id,
                                email: user.email,
                                action: 'demote',
                              })}
                            >
                              {actionLoading === user.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ShieldOff className="h-3 w-3" />
                              )}
                              {t.admin?.demote || 'Remove Admin'}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              disabled={actionLoading === user.id}
                              onClick={() => setConfirmDialog({
                                open: true,
                                userId: user.id,
                                email: user.email,
                                action: 'promote',
                              })}
                            >
                              {actionLoading === user.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Shield className="h-3 w-3" />
                              )}
                              {t.admin?.promote || 'Make Admin'}
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            className="gap-1"
                            disabled={actionLoading === user.id}
                            onClick={() => setConfirmDialog({
                              open: true,
                              userId: user.id,
                              email: user.email,
                              action: 'delete',
                            })}
                          >
                            {actionLoading === user.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            {t.admin?.delete || 'Delete'}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDialog?.open} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogContent.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogContent.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmAction}
              className={confirmDialog?.action === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {t.common.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
