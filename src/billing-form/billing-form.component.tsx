import React, { useState, useEffect } from 'react';
import {
  ButtonSet,
  Button,
  RadioButtonGroup,
  RadioButton,
  Search,
  Table,
  TableHead,
  TableBody,
  TableHeader,
  TableRow,
  TableCell,
} from '@carbon/react';
import styles from './billing-form.scss';
import { useTranslation } from 'react-i18next';
import { restBaseUrl, showSnackbar, showToast, useConfig } from '@openmrs/esm-framework';
import { useFetchSearchResults, processBillItems } from '../billing.resource';
import { mutate } from 'swr';
import { convertToCurrency } from '../helpers';
import { z } from 'zod';
import { TrashCan } from '@carbon/react/icons';
import debounce from 'lodash-es/debounce';

type BillingFormProps = {
  patientUuid: string;
  closeWorkspace: () => void;
};

const BillingForm: React.FC<BillingFormProps> = ({ patientUuid, closeWorkspace }) => {
  const { t } = useTranslation();
  const { defaultCurrency } = useConfig();

  const [grandTotal, setGrandTotal] = useState(0);
  const [searchOptions, setSearchOptions] = useState([]);
  const [billItems, setBillItems] = useState([]);
  const [searchVal, setSearchVal] = useState('');
  const [category, setCategory] = useState('');
  const [saveDisabled, setSaveDisabled] = useState<boolean>(false);
  const [addedItems, setAddedItems] = useState([]);
  const [noResultsMessage, setNoResultsMessage] = useState('');

  const toggleSearch = (choiceSelected) => {
    (document.getElementById('searchField') as HTMLInputElement).disabled = false;
    setCategory(choiceSelected === 'Stock Item' ? 'Stock Item' : 'Service');
  };

  const billItemSchema = z.object({
    Qnty: z.number().min(1, t('quantityGreaterThanZero', 'Quantity must be at least one for all items.')), // zod logic
  });

  const calculateTotal = (event, itemName) => {
    const quantity = parseInt(event.target.value);
    let isValid = true;

    try {
      billItemSchema.parse({ Qnty: quantity });
    } catch (error) {
      isValid = false;
      const parsedErrorMessage = JSON.parse(error.message);
      showToast({
        title: t('billItems', 'Save Bill'),
        kind: 'error',
        description: parsedErrorMessage[0].message,
      });
    }

    const updatedItems = billItems.map((item) => {
      if (item.Item.toLowerCase().includes(itemName.toLowerCase())) {
        return { ...item, Qnty: quantity, Total: quantity > 0 ? item.Price * quantity : 0 };
      }
      return item;
    });

    const anyInvalidQuantity = updatedItems.some((item) => item.Qnty <= 0);

    setBillItems(updatedItems);
    setSaveDisabled(!isValid || anyInvalidQuantity);

    const updatedGrandTotal = updatedItems.reduce((acc, item) => acc + item.Total, 0);
    setGrandTotal(updatedGrandTotal);
  };

  const calculateTotalAfterAddBillItem = (items) => {
    const sum = items.reduce((acc, item) => acc + item.Price * item.Qnty, 0);
    setGrandTotal(sum);
  };

  const addItemToBill = (event, itemid, itemname, itemcategory, itemPrice) => {
    const newItem = {
      uuid: itemid,
      Item: itemname,
      Qnty: 1,
      Price: itemPrice,
      Total: itemPrice,
      category: itemcategory,
    };

    const updatedItems = [...billItems, newItem];
    setBillItems(updatedItems);

    setAddedItems([...addedItems, newItem]);

    setSearchOptions([]);
    calculateTotalAfterAddBillItem(updatedItems);
    (document.getElementById('searchField') as HTMLInputElement).value = '';
  };

  const removeItemFromBill = (uuid) => {
    const updatedItems = billItems.filter((item) => item.uuid !== uuid);
    setBillItems(updatedItems);

    // Update the list of added items
    setAddedItems(addedItems.filter((item) => item.uuid !== uuid));

    const updatedGrandTotal = updatedItems.reduce((acc, item) => acc + item.Total, 0);
    setGrandTotal(updatedGrandTotal);
  };

  const { data, error, isLoading, isValidating } = useFetchSearchResults(searchVal, category);

  const filterItems = async (val) => {
    setSearchVal(val);
    setNoResultsMessage('');

    if (!isLoading && data) {
      const res = data as { results: any[] };

      const options = res.results.map((o) => {
        if (!addedItems.some((item) => item.uuid === o.uuid)) {
          if (o.commonName && o.commonName !== '') {
            return {
              uuid: o.uuid || '',
              Item: o.commonName,
              Qnty: 1,
              Price: 10,
              Total: 10,
              category: 'StockItem',
            };
          } else if (
            o.name.toLowerCase().includes(val.toLowerCase()) ||
            o.name.toLowerCase().startsWith(val.toLowerCase())
          ) {
            return {
              uuid: o.uuid || '',
              Item: o.name,
              Qnty: 1,
              Price: o.servicePrices[0].price,
              Total: o.servicePrices[0].price,
              category: 'Service',
            };
          }
        }
        return null;
      });

      setSearchOptions(options.filter((option) => option)); // Filter out undefined/null values
      if (options.length === 0 || error) {
        setNoResultsMessage('No results found.');
      } else {
        setNoResultsMessage('');
      }
    } else {
      setNoResultsMessage('No results found.');
    }
  };

  const debouncedFilterItems = debounce((val) => {
    filterItems(val);
  }, 300); // Adjust the delay as needed

  const postBillItems = () => {
    const bill = {
      cashPoint: '54065383-b4d4-42d2-af4d-d250a1fd2590',
      cashier: 'f9badd80-ab76-11e2-9e96-0800200c9a66',
      lineItems: [],
      payments: [],
      patient: patientUuid,
      status: 'PENDING',
    };

    billItems.forEach((item) => {
      const lineItem: any = {
        quantity: parseInt(item.Qnty),
        price: item.Price,
        priceName: 'Default',
        priceUuid: '7b9171ac-d3c1-49b4-beff-c9902aee5245',
        lineItemOrder: 0,
        paymentStatus: 'PENDING',
      };

      if (item.category === 'StockItem') {
        lineItem.item = item.uuid;
      } else {
        lineItem.billableService = item.uuid;
      }

      bill?.lineItems.push(lineItem);
    });

    const url = `${restBaseUrl}/cashier/bill`;
    processBillItems(bill).then(
      () => {
        closeWorkspace();
        mutate((key) => typeof key === 'string' && key.startsWith(url), undefined, { revalidate: true });
        showSnackbar({
          title: t('billItems', 'Save Bill'),
          subtitle: 'Bill processing has been successful',
          kind: 'success',
          timeoutInMs: 3000,
        });
      },
      (error) => {
        showSnackbar({ title: 'Bill processing error', kind: 'error', subtitle: error });
      },
    );
  };

  return (
    <div className={styles.billingFormContainer}>
      <RadioButtonGroup
        legendText={t('selectCategory', 'Select category')}
        name="radio-button-group"
        defaultSelected="radio-1"
        className={styles.billingItem}
        onChange={toggleSearch}>
        <RadioButton labelText={t('stockItem', 'Stock Item')} value="Stock Item" id="stockItem" />
        <RadioButton labelText={t('service', 'Service')} value="Service" id="service" />
      </RadioButtonGroup>

      <div>
        <Search
          id="searchField"
          size="lg"
          placeholder="Find your items here..."
          labelText="Search"
          disabled
          closeButtonLabelText="Clear search input"
          onChange={() => {}}
          className={styles.billingItem}
          onKeyUp={(e) => {
            debouncedFilterItems(e.target.value);
          }}
        />

        <ul className={styles.searchContent}>
          {searchOptions.map((row) => (
            <li key={row.uuid} className={styles.searchItem}>
              <Button
                id={row.uuid}
                onClick={(e) => addItemToBill(e, row.uuid, row.Item, row.category, row.Price)}
                style={{ background: 'inherit', color: 'black' }}>
                {row.Item} Qnty.{row.Qnty} Ksh.{row.Price}
              </Button>
            </li>
          ))}
        </ul>
        {noResultsMessage && <p>{noResultsMessage}</p>}
      </div>

      <Table aria-label="sample table" className={styles.billingItem}>
        <TableHead>
          <TableRow>
            <TableHeader>Item</TableHeader>
            <TableHeader>Quantity</TableHeader>
            <TableHeader>Price</TableHeader>
            <TableHeader>Total</TableHeader>
            <TableHeader>Action</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {billItems && Array.isArray(billItems) ? (
            billItems.map((row) => (
              <TableRow>
                <TableCell>{row.Item}</TableCell>
                <TableCell>
                  <input
                    type="number"
                    className={`form-control ${row.Qnty <= 0 ? styles.invalidInput : ''}`}
                    id={row.Item}
                    min={0}
                    max={100}
                    value={row.Qnty}
                    onChange={(e) => {
                      calculateTotal(e, row.Item);
                      row.Qnty = e.target.value;
                    }}
                  />
                </TableCell>
                <TableCell id={row.Item + 'Price'}>{row.Price}</TableCell>
                <TableCell id={row.Item + 'Total'} className="totalValue">
                  {row.Total}
                </TableCell>
                <TableCell>
                  <TrashCan onClick={() => removeItemFromBill(row.uuid)} className={styles.removeButton} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <p>Loading...</p>
          )}
          <TableRow>
            <TableCell></TableCell>
            <TableCell></TableCell>
            <TableCell style={{ fontWeight: 'bold' }}>Grand Total:</TableCell>
            <TableCell id="GrandTotalSum">{convertToCurrency(grandTotal, defaultCurrency)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <ButtonSet className={styles.billingItem}>
        <Button kind="secondary" onClick={closeWorkspace}>
          Discard
        </Button>
        <Button
          kind="primary"
          disabled={saveDisabled}
          onClick={() => {
            postBillItems();
          }}>
          Save & Close
        </Button>
      </ButtonSet>
    </div>
  );
};

export default BillingForm;
