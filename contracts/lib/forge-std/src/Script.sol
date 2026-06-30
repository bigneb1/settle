// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;

import {VmSafe} from "./Vm.sol";
import {console2} from "./console2.sol";

abstract contract Script {
    bool public IS_SCRIPT = true;
    address constant private VM_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;
    VmSafe internal constant vmSafe = VmSafe(VM_ADDRESS);
    VmSafe internal constant vm = VmSafe(VM_ADDRESS);
}
