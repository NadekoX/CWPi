import {
  ComputerUseClient,
  type ComputerUsePermissions,
  resolveComputerUseHelperPath,
} from "@cwpi/computer-use";

export class ComputerUsePermissionService {
  public async getPermissions(signal?: AbortSignal): Promise<ComputerUsePermissions> {
    const client = new ComputerUseClient({ helperPath: resolveComputerUseHelperPath() });
    try {
      return await client.getPermissions(signal);
    } finally {
      client.close();
    }
  }
}
