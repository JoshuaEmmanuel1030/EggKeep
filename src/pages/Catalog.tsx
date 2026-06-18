import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Egg, Package, Tag, Box, Users } from "lucide-react";
import { SKUList } from "@/components/catalog/SKUList";
import { ItemTypeList } from "@/components/catalog/ItemTypeList";
import { BuyerList } from "@/components/catalog/BuyerList";
import { RecalculateInventoryButton } from "@/components/admin/RecalculateInventoryButton";

export function Catalog() {
  const { t } = useLanguage();
  const { isAdmin } = useUserRole();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t.catalog.title}</h2>
          <p className="text-muted-foreground">{t.catalog.manageCatalog}</p>
        </div>
        {isAdmin && <RecalculateInventoryButton />}
      </div>

      <Tabs defaultValue="skus" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto p-1 gap-1">
          <TabsTrigger value="skus" className="gap-1.5 text-xs sm:text-sm h-9">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.skus}</span>
          </TabsTrigger>
          <TabsTrigger value="eggs" className="gap-1.5 text-xs sm:text-sm h-9">
            <Egg className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.eggs}</span>
          </TabsTrigger>
          <TabsTrigger value="boxes" className="gap-1.5 text-xs sm:text-sm h-9">
            <Box className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.boxes}</span>
          </TabsTrigger>
          <TabsTrigger value="labels" className="gap-1.5 text-xs sm:text-sm h-9">
            <Tag className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.labels}</span>
          </TabsTrigger>
          <TabsTrigger value="packaging" className="gap-1.5 text-xs sm:text-sm h-9">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.packaging}</span>
          </TabsTrigger>
          <TabsTrigger value="buyers" className="gap-1.5 text-xs sm:text-sm h-9">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">{t.catalog.buyers}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skus">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {t.catalog.skus}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SKUList isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="eggs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Egg className="h-5 w-5" />
                {t.catalog.eggs}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ItemTypeList category="egg" isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boxes">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Box className="h-5 w-5" />
                {t.catalog.boxes}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ItemTypeList category="box" isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labels">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                {t.catalog.labels}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ItemTypeList category="label" isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packaging">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {t.catalog.packaging}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ItemTypeList category="packaging" isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyers">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {t.catalog.buyers}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BuyerList isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
