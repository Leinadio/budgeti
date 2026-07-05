import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listRules } from "../../db/repositories/rules";
import { addCategory, createRule } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CategorySelectField } from "@/components/category-select-field";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const database = db();
  const categories = listCategories(database);
  const categoryNames = categories.map((c) => c.name);
  const rules = listRules(database);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Catégories</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="list-inside list-disc text-sm">
            {categories.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
          <form action={addCategory} className="flex items-center gap-2">
            <Input name="name" placeholder="Nouvelle catégorie" className="max-w-60" />
            <Button type="submit" size="sm">
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règles de catégorisation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mot-clé</TableHead>
                <TableHead>Catégorie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.keyword}</TableCell>
                  <TableCell>{r.category}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <form action={createRule} className="flex items-center gap-2">
            <Input name="keyword" placeholder="Mot-clé (ex. DECATHLON)" className="max-w-60" />
            <CategorySelectField name="category" categories={categoryNames} placeholder="Catégorie" />
            <Button type="submit" size="sm">
              Ajouter la règle
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
