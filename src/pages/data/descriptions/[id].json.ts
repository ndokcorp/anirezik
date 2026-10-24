import type { APIRoute } from 'astro';
import { descriptions } from '../../../lib/descriptions';
export const getStaticPaths = () =>
  [...descriptions].map(([id, description]) => ({
    params: { id: String(id) },
    props: { description },
  }));
export const GET: APIRoute = ({ props }) => Response.json(props.description);
