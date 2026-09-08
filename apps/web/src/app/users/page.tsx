import { UsersPage } from "../../components/users-page";
import { getUsers } from "../../data/users";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  const query = await searchParams;
  return <UsersPage users={await getUsers()} saved={queryValue(query.saved)} error={queryValue(query.error)} />;
}
